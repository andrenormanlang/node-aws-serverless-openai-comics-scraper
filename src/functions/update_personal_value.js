import handler from "../libs/handler-lib";
import * as defs from "../libs/defs";
import * as dynamoDbLib from "../libs/dynamodb-lib";

export const main = handler(async (event, context) => {
  const userId = event.requestContext.identity.cognitoIdentityId;

  const body = JSON.parse(event.body);

  if (
    !Object.keys(body).length ||
    !Object.keys(body).includes("subjectId") ||
    !Object.keys(body).includes("action")
  )
    return { error: "body must contain both subjectId and action" };

  const subjectId = Number(body.subjectId) || 0;
  const value = Number(body.action === "like" ? 1 : -1);
  const timeStamp = Math.floor(new Date().getTime() / 1000);

  if (!userId) {
    console.error("update_personal_value: userId is missing");
    return { error: "User ID is required" };
  }

  const itemId = `${userId}#personalValues`;
  console.log(`update_personal_value: Writing to id="${itemId}", sortKey="${subjectId}", value=${value} (type: ${typeof value})`);

  // New structure: One item per subject
  const query = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: itemId,
      sortKey: subjectId.toString(),
        },
        ExpressionAttributeNames: {
      "#value": "value",
      "#timeStamp": "timeStamp",
        },
        ExpressionAttributeValues: {
      ":value": value,
      ":timeStamp": timeStamp,
        },
    UpdateExpression: "SET #value = :value, #timeStamp = :timeStamp",
      ReturnValues: "ALL_NEW",
    };

  const result = await dynamoDbLib.call("update", query);
  return {
    result: {
      subjectId: Number(result.Attributes.sortKey) || 0,
      value: Number(result.Attributes.value) || 0,
    }
  };
});
