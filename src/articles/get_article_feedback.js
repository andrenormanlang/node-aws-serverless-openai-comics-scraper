import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import handler from "../libs/handler-lib";

export const main = handler(async (event, context) => {
  const userId = event.requestContext.identity.cognitoIdentityId;
  const q = {
    url: decodeURIComponent(event.pathParameters.articleUrl),
  };

  if (!q.url) return;

  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: `feedback#${userId}`,
      sortKey: q.url,
    },
  };

  const result = await dynamoDbLib.call("get", params);

  if (!Object.keys(result).length)
    return {
      likeBalance: 0,
      trustBalance: 0,
      support: false,
    };

  return {
    likeBalance: Object.keys(result.Item).includes("likeBalance")
      ? result.Item.likeBalance
      : 0,
    trustBalance: Object.keys(result.Item).includes("trustBalance")
      ? result.Item.trustBalance
      : 0,
    support: false,
  };
});
