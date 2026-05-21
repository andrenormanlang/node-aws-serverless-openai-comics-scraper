import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import handler from "../libs/handler-lib";

export const main = handler(async (event, context) => {
  const userId = event.requestContext.identity.cognitoIdentityId;

  if (!userId) return;

  const paramsArticles = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "supportArticles",
      sortKey: userId,
    },
  };

  const paramsComments = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "supportComments",
      sortKey: userId,
    },
  };

  const resultArticles = await dynamoDbLib.call("get", paramsArticles);
  const resultComments = await dynamoDbLib.call("get", paramsComments);

  const result = {
    articles: Array.isArray(resultArticles?.Item?.content)
      ? resultArticles.Item.content
      : [],
    comments: Array.isArray(resultComments?.Item?.content)
      ? resultComments.Item.content
      : [],
  };

  return result;
});
