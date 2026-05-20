import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import handler from "../libs/handler-lib";

export const main = handler(async (event, context) => {
  console.log(JSON.stringify(event));
  const userId = decodeURIComponent(event.pathParameters.userId);
  console.log(`event.pathParameters.userId: ${userId}`);

  if (!userId) return { error: "user id is not provided" };

  // New structure: Query all items with id = userId#personalValues
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    KeyConditionExpression: "id = :id",
    ExpressionAttributeValues: {
      ":id": `${userId}#personalValues`,
    },
  };

  const result = await dynamoDbLib.call("query", params);

  // Convert new structure to array format for frontend compatibility.
  const normalizedSubjects = result.Items
    .filter((item) => {
      // Only process items from new structure
      return item.id && item.id.endsWith('#personalValues');
    })
    .map((item) => {
      // Convert sortKey to Number (subjectId)
      const subjectId = Number(item.sortKey) || 0;

      // Convert value to Number, handling both string and number types from new structure
      let value = Number(item.value);
      // Ensure it's a valid number (not NaN)
      if (isNaN(value)) {
        value = 0;
      }

      return { subjectId, value };
    });

  if (normalizedSubjects.length > 0) {
    return { personalValues: normalizedSubjects };
  }

  const legacyParams = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "personalValues",
      sortKey: userId,
    },
  };
  const legacyResult = await dynamoDbLib.call("get", legacyParams);
  const legacySubjects = ((legacyResult.Item && legacyResult.Item.subjects) || [])
    .map((item) => ({
      subjectId: Number(item.subjectId) || 0,
      value: Number(item.value) || 0,
    }))
    .filter((item) => item.subjectId > 0);

  if (legacySubjects.length > 0) {
    console.log(
      `find_personal_values: using legacy personalValues fallback for ${userId}`
    );
  }

  return { personalValues: legacySubjects };
});
