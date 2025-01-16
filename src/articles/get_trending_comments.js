import * as defs from "../libs/defs";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import handler from "../libs/handler-lib";

export const main = handler(async (event, context) => {
  const currentDate = parseInt(new Date().getTime() / 1000);
  const day = 86400;
  const endDate = currentDate - 7 * day;
  const userId = event.requestContext.identity.cognitoIdentityId;
  const data = event.queryStringParameters;
  console.log("SORTKEY FOR EVERY COMMENT", data.sortKey);

  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    IndexName: "sortKey-addedTS-index",
    ExpressionAttributeValues: {
      ":sortKey": data.sortKey,
      ":end_date": endDate,
    },
    KeyConditionExpression: "sortKey = :sortKey and addedTS >= :end_date",
  };

  try {
    const result = await dynamoDbLib.call("query", params);

    const filtered = result.Items.filter((a) => a.msgCount > 0)
      .sort((a, b) => {
        if (a.msgCount > b.msgCount) return -1;
        if (a.msgCount < b.msgCount) return 1;
        return 0;
      })
      .sort((a, b) => {
        if (
          (7 * day - a.addedTS) * a.msgCount >
          (7 * day - b.addedTS) * b.msgCount
        )
          return -1;
        if (
          (7 * day - a.addedTS) * a.msgCount <
          (7 * day - a.addedTS) * b.msgCount
        )
          return 1;
        return 0;
      });

    const toReturn = filtered.map((art) => {
      return {
        ...art,
        trust: {
          amount: art.trust.users.length,
          status: art.trust.users.includes(userId),
        },
        distrust: {
          amount: art.distrust.users.length,
          status: art.distrust.users.includes(userId),
        },
        likes: {
          amount: art.likes.users.length,
          status: art.likes.users.includes(userId),
        },
        dislikes: {
          amount: art.dislikes.users.length,
          status: art.dislikes.users.includes(userId),
        },
        support: {
          amount: art.support.length,
          status: art.support.includes(userId),
        },
        subjects: art.subjects.map((subject) => {
          return {
            id: subject.id,
            users: subject.users.length,
            status: subject.users.includes(userId),
          };
        }),
      };
    });
    return toReturn;
  } catch (e) {
    return e;
  }
});
