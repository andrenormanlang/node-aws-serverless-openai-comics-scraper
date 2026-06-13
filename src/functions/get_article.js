import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import handler from "../libs/handler-lib";

export const main = handler(async (event, context) => {
  const userId = event.requestContext?.identity?.cognitoIdentityId ?? null;

  const q = { url: decodeURIComponent(event.pathParameters.url) };
  const data = event.queryStringParameters ?? {};

  if (!q.url || !data.sortKey) return {};

  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: { id: q.url, sortKey: data.sortKey },
  };

  const result = await dynamoDbLib.call("get", params);

  // Correct miss check: the item itself, not the response wrapper. Also guards
  // every result.Item access below from throwing on a missing record.
  if (!result || !result.Item) return {};

  const item = result.Item;

  // Helper: safe array of users for vote/relationship attributes that may be
  // absent or malformed on older / mixed-shape records.
  const usersOf = (field) =>
    field && Array.isArray(field.users) ? field.users : [];

  const trustUsers = usersOf(item.trust);
  const distrustUsers = usersOf(item.distrust);
  const likeUsers = usersOf(item.likes);
  const dislikeUsers = usersOf(item.dislikes);
  const supportUsers = Array.isArray(item.support) ? item.support : [];
  const subjects = Array.isArray(item.subjects) ? item.subjects : [];

  // Resolve vote counts: prefer counters, fall back to array length.
  const likesAmount =
    typeof item.interestCount === "number"
      ? item.interestCount
      : likeUsers.length;
  const dislikesAmount =
    typeof item.uninterestCount === "number"
      ? item.uninterestCount
      : dislikeUsers.length;

  return {
    ...item,
    trust: {
      amount: trustUsers.length,
      status: trustUsers.includes(userId),
    },
    distrust: {
      amount: distrustUsers.length,
      status: distrustUsers.includes(userId),
    },
    likes: {
      amount: likesAmount,
      status: likeUsers.includes(userId),
    },
    dislikes: {
      amount: dislikesAmount,
      status: dislikeUsers.includes(userId),
    },
    support: {
      amount: supportUsers.length,
      status: supportUsers.includes(userId),
    },
    subjects: subjects.map((subject) => ({
      id: subject.id,
      users: Array.isArray(subject.users) ? subject.users.length : 0,
      status: Array.isArray(subject.users)
        ? subject.users.includes(userId)
        : false,
    })),
  };
});