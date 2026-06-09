import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import handler from "../libs/handler-lib";

export const main = handler(async (event, context) => {
  const userId = event.requestContext?.identity?.cognitoIdentityId ?? null;
  const q = {
    url: decodeURIComponent(event.pathParameters.url),
  };
  console.log(event);
  const data = event.queryStringParameters ?? {};
  console.log("koko: ", data);
  if (!q.url || !data.sortKey) return {};

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

  // Resolve vote counts: prefer `interestCount`/`uninterestCount`, fallback to likes/dislikes arrays
  const likesAmount =
    typeof result.Item.interestCount === "number"
      ? result.Item.interestCount
      : result.Item.likes && result.Item.likes.users
      ? result.Item.likes.users.length
      : 0;
  const dislikesAmount =
    typeof result.Item.uninterestCount === "number"
      ? result.Item.uninterestCount
      : result.Item.dislikes && result.Item.dislikes.users
      ? result.Item.dislikes.users.length
      : 0;

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
      amount: likesAmount,
      status:
        result.Item.likes && result.Item.likes.users
          ? result.Item.likes.users.includes(userId)
          : false,
    },
    dislikes: {
      amount: dislikesAmount,
      status:
        result.Item.dislikes && result.Item.dislikes.users
          ? result.Item.dislikes.users.includes(userId)
          : false,
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
