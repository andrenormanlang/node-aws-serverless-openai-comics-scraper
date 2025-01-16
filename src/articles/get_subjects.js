import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import handler from "../libs/handler-lib";

export const main = handler(async (event, context) => {
  const userId = event.requestContext.identity.cognitoIdentityId;

  if (!userId) return;

  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "subjects",
      sortKey: "article",
    },
  };

  const result = await dynamoDbLib.call("get", params);
  return result.Item.subjects;
});
