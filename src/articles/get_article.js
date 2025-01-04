import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import handler from "../libs/handler-lib";

export const main = handler(async (event, context) => {
  const userId = event.requestContext.identity.cognitoIdentityId;
  const q = {
    url: decodeURIComponent(event.pathParameters.url),
  };
  console.log(event);
  const data = event.queryStringParameters;
  console.log("koko: ", data);
  if (!userId || !q.url) return;

  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: q.url,
      sortKey: data.sortKey,
    },
  };

  const result = await dynamoDbLib.call("get", params);

  console.log("asdf: ", result.Item);
  if (!Object.keys(result).length) return {};

  //pretty sure i have to reset db

  return {
    ...result.Item,
    trust: {
      amount: result.Item.trust.users.length,
      status: result.Item.trust.users.includes(userId),
    },
    distrust: {
      amount: result.Item.distrust.users.length,
      status: result.Item.distrust.users.includes(userId),
    },
    likes: {
      amount: result.Item.likes.users.length,
      status: result.Item.likes.users.includes(userId),
    },
    dislikes: {
      amount: result.Item.dislikes.users.length,
      status: result.Item.dislikes.users.includes(userId),
    },
    support: {
      amount: result.Item.support.length,
      status: result.Item.support.includes(userId),
    },
    subjects: result.Item.subjects.map((subject) => {
      return {
        id: subject.id,
        users: subject.users.length,
        status: subject.users.includes(userId),
      };
    }),
  };
});