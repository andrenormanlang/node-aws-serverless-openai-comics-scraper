import handler from "../libs/handler-lib";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";

export const main = handler(async (event, context) => {
  const userId = event.requestContext.identity.cognitoIdentityId;

  const body = JSON.parse(event.body) || {};

  if (!userId || !body.url || !body.subjectId) return;
  console.log(body.sortKey);
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: body.url,
      sortKey: body.sortKey,
    },
  };

  const sub = await dynamoDbLib.call("get", params);
  let subjects = sub.Item.subjects;

  for (let subject of subjects) {
    const index = subject.users.indexOf(userId);
    if (index >= 0) {
      subject.users.splice(index, 1);
      break;
    }
  }

  const subject = subjects.find((subject) => subject.id === body.subjectId);
  if (subject) {
    if (subject.users.includes(userId)) {
      console.log("already chosen this");
      return;
    } else {
      subject.users.push(userId);
    }
  } else {
    subjects.push({
      id: body.subjectId,
      users: [userId],
    });
  }

  const query = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: body.url,
      sortKey: body.sortKey,
    },
    ExpressionAttributeNames: {
      "#subjects": "subjects",
    },
    ExpressionAttributeValues: {
      ":subjects": subjects,
    },
    UpdateExpression: `SET #subjects = :subjects`,
    ReturnValues: "ALL_NEW",
  };

  const result = await dynamoDbLib.call("update", query);

  return {
    ...result.Attributes,
    trust: {
      amount: result.Attributes.trust.users.length,
      status: result.Attributes.trust.users.includes(userId),
    },
    distrust: {
      amount: result.Attributes.distrust.users.length,
      status: result.Attributes.distrust.users.includes(userId),
    },
    likes: {
      amount: result.Attributes.likes.users.length,
      status: result.Attributes.likes.users.includes(userId),
    },
    dislikes: {
      amount: result.Attributes.dislikes.users.length,
      status: result.Attributes.dislikes.users.includes(userId),
    },
    support: {
      amount: result.Attributes.support.length,
      status: result.Attributes.support.includes(userId),
    },
    subjects: result.Attributes.subjects.map((subject) => {
      return {
        id: subject.id,
        users: subject.users.length,
        status: subject.users.includes(userId),
      };
    }),
  };
});
