import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import handler from "../libs/handler-lib";

const BUCKETS = [
  { x: "-3.0", y: 0 },
  { x: "-2.0", y: 0 },
  { x: "-1.0", y: 0 },
  { x: "0.0", y: 0 },
  { x: "1.0", y: 0 },
  { x: "2.0", y: 0 },
  { x: "3.0", y: 0 },
];

function bucketIndexForValue(raw) {
  const value = Number(raw);
  if (Number.isNaN(value)) return null;
  if (value >= 2.5 && value <= 3.0) return 6;
  if (value >= 1.5 && value < 2.5) return 5;
  if (value >= 0.1 && value < 1.5) return 4;
  if (value === 0) return 3;
  if (value > -1.5 && value < 0) return 2;
  if (value > -2.5 && value <= -1.5) return 1;
  if (value >= -3.0 && value <= -2.6) return 0;
  return null;
}

export const main = handler(async (event, context) => {
  const userId = event.requestContext.identity.cognitoIdentityId;

  if (!userId) return;

  const subjectId = decodeURIComponent(event.pathParameters.subjectId);
  const debug =
    event.queryStringParameters &&
    (event.queryStringParameters.debug === "1" ||
      event.queryStringParameters.debug === "true");

  let exclusiveStartKey;
  const allItems = [];
  const baseParams = {
    TableName: defs.WN_STR_KEY_TABLE,
    IndexName: "GSI_Index",
    KeyConditionExpression: "sortKey = :sortKey",
    ExpressionAttributeValues: {
      ":sortKey": String(subjectId),
    },
  };

  do {
    const params = exclusiveStartKey
      ? { ...baseParams, ExclusiveStartKey: exclusiveStartKey }
      : baseParams;
    const page = await dynamoDbLib.call("query", params);
    if (page.Items && page.Items.length) {
      allItems.push(...page.Items);
    }
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);

  const statistics = BUCKETS.map((b) => ({ ...b }));

  let usedRows = 0;
  let skippedNonPersonal = 0;
  let skippedBucket = 0;

  for (const row of allItems) {
    if (!row.id || typeof row.id !== "string" || !row.id.endsWith("#personalValues")) {
      skippedNonPersonal++;
      continue;
    }
    const idx = bucketIndexForValue(row.value);
    if (idx === null) {
      skippedBucket++;
      continue;
    }
    statistics[idx].y++;
    usedRows++;
  }

  const out = { statistics };
  if (debug) {
    out._debug = {
      subjectId: String(subjectId),
      gsiRowCount: allItems.length,
      personalValueRowsCounted: usedRows,
      skippedNonPersonalValuesId: skippedNonPersonal,
      skippedOutOfRangeValue: skippedBucket,
    };
  }

  console.log(
    `get_personal_statistics subjectId=${subjectId} gsi=${allItems.length} used=${usedRows}`
  );
  return out;
});
