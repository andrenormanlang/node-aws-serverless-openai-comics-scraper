import * as defs from "../libs/defs";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import handler from "../libs/handler-lib";

export const main = handler(async (event, context) => {
  const currentDate = parseInt(new Date().getTime() / 1000);
  const day = 86400;
  const endDate = currentDate - 1 * day;
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

    const filtered = result.Items.filter((a) => a.likes.users.length > 0)
      .sort((a, b) => {
        if (a.likes.users.length > b.likes.users.length) return -1;
        if (a.likes.users.length < b.likes.users.length) return 1;
        return 0;
      })
      .sort((a, b) => {
        const aTotal = a.likes.users.length + a.dislikes.users.length;
        const bTotal = b.likes.users.length + b.dislikes.users.length;

        if (
          (1 * day - a.addedTS) * (a.likes.users.length / aTotal) >
          (1 * day - b.addedTS) * (b.likes.users.length / bTotal)
        )
          return 1;
        if (
          (1 * day - a.addedTS) * (a.likes.users.length / aTotal) <
          (1 * day - b.addedTS) * (b.likes.users.length / bTotal)
        )
          return -1;
        return 0;
      });

    /*
    .sort((a, b) => {
      const aTotal = a.likes.users.length + a.dislikes.users.length;
      const bTotal = b.likes.users.length + b.dislikes.users.length;
      if ((a.likes.users.length / aTotal) > (b.likes.users.length / bTotal)) return -1;
      if ((a.likes.users.length / aTotal) < (b.likes.users.length / bTotal)) return 1;
      return 0;
    });
    */
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
    console.log(e);
    return e;
  }
});
