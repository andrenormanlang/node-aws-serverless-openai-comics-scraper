import handler from "../libs/handler-lib";
import * as defs from "../libs/defs";
import * as dynamoDbLib from "../libs/dynamodb-lib";

export const main = handler(async (event, context) => {
  const userId = event.requestContext.identity.cognitoIdentityId;

  const body = JSON.parse(event.body);

  if (
    !Object.keys(body).length ||
    !Object.keys(body).includes("personalValues")
  )
    return { error: "body must contain personalValues" };

  console.log(body.personalValues);

  // Ensure all values are numbers, not strings
  const normalizedPersonalValues = body.personalValues.map((item) => {
    const subjectId = Number(item.subjectId) || 0;
    // Convert value to number, handling both string and number inputs
    let value = Number(item.value);
    // Ensure it's a valid number (not NaN)
    if (isNaN(value)) {
      value = 0;
    }
    return { subjectId, value };
  });

  const timeStamp = Math.floor(new Date().getTime() / 1000);
  const results = [];

  if (!userId) {
    console.error("update_all_personal_values: userId is missing");
    return { error: "User ID is required" };
  }

  const itemId = `${userId}#personalValues`;
  console.log(`update_all_personal_values: Writing ${normalizedPersonalValues.length} items to id="${itemId}"`);

  // New structure: Create/update one item per subject
  for (const item of normalizedPersonalValues) {
    console.log(`update_all_personal_values: Writing sortKey="${item.subjectId}", value=${item.value} (type: ${typeof item.value})`);
    try {
      const query = {
        TableName: defs.WN_STR_KEY_TABLE,
        Key: {
          id: itemId,
          sortKey: item.subjectId.toString(),
        },
        ExpressionAttributeNames: {
          "#value": "value",
          "#timeStamp": "timeStamp",
        },
        ExpressionAttributeValues: {
          ":value": Number(item.value), // Explicitly ensure Number type
          ":timeStamp": timeStamp,
        },
        UpdateExpression: "SET #value = :value, #timeStamp = :timeStamp",
        ReturnValues: "ALL_NEW",
      };

      const result = await dynamoDbLib.call("update", query);
      results.push({
        subjectId: Number(result.Attributes.sortKey) || 0,
        value: Number(result.Attributes.value) || 0,
      });
    } catch (error) {
      console.error(`update_all_personal_values: Error writing item for subjectId ${item.subjectId}:`, error);
      throw error;
    }
  }

  return { result: results };
});
