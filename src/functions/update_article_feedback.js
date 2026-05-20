import handler from "../libs/handler-lib";
import * as defs from "../libs/defs";
import * as dynamoDbLib from "../libs/dynamodb-lib";

export const main = handler(async (event, context) => {
  const data = JSON.parse(event.body);
  const userId = event.requestContext.identity.cognitoIdentityId;
  const url = decodeURIComponent(event.pathParameters.url);

  if (!userId) return { status: 400, error: "could not validate user" };

  const query = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: url,
      sortKey: data.sortKey,
    },
  };

  const { Item } = await dynamoDbLib.call("get", query);

  const feedback = {
    likes: Item.likes,
    dislikes: Item.dislikes,
    trust: Item.trust,
    distrust: Item.distrust,
  };

  const opposite = {
    likes: "dislikes",
    dislikes: "likes",
    trust: "distrust",
    distrust: "trust",
  };
  console.log("Article feedback action :", data.action);
  const alreadyChosen = feedback[data.action].users.includes(userId);
  if (alreadyChosen) {
    return { status: 404, message: "already chosen" };
  } else {
    const foundOppositeIndex =
      feedback[opposite[data.action]].users.indexOf(userId);

    if (foundOppositeIndex !== -1) {
      feedback[opposite[data.action]].users.splice(foundOppositeIndex, 1);
    }
    feedback[data.action].users.push(userId);
  }

  const queryPut = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: url,
      sortKey: data.sortKey,
    },
    ExpressionAttributeNames: {
      "#likes": "likes",
      "#dislikes": "dislikes",
      "#trust": "trust",
      "#distrust": "distrust",
    },
    ExpressionAttributeValues: {
      ":likes": feedback.likes,
      ":dislikes": feedback.dislikes,
      ":trust": feedback.trust,
      ":distrust": feedback.distrust,
    },
    UpdateExpression: `SET #likes = :likes, #dislikes = :dislikes, #trust = :trust, #distrust = :distrust`,
    ReturnValues: "ALL_NEW",
  };

  const result = await dynamoDbLib.call("update", queryPut);
  const article = result.Attributes;

  return {
    ...article,
    trust: {
      amount: article.trust.users.length,
      status: article.trust.users.includes(userId),
    },
    distrust: {
      amount: article.distrust.users.length,
      status: article.distrust.users.includes(userId),
    },
    likes: {
      amount: article.likes.users.length,
      status: article.likes.users.includes(userId),
    },
    dislikes: {
      amount: article.dislikes.users.length,
      status: article.dislikes.users.includes(userId),
    },
    support: {
      amount: article.support.length,
      status: article.support.includes(userId),
    },
    subjects: article.subjects.map((subject) => {
      return {
        id: subject.id,
        users: subject.users.length,
        status: subject.users.includes(userId),
      };
    }),
  };
});
