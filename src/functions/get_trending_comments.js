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
    ExpressionAttributeNames: {
      "#m": "msgCount",
    },
    ExpressionAttributeValues: {
      ":sortKey": data.sortKey,
      ":end_date": endDate,
      ":msgCount": 0,
    },
    KeyConditionExpression: "sortKey = :sortKey and addedTS >= :end_date",
    FilterExpression: "#m > :msgCount",
    ScanIndexForward: false,
    // Limit: 100,
  };

  try {
    let result = [];
    let lastEvalValue;

    // Loop until all the values are fetched or resukt is <= 100
    do {
      if (lastEvalValue) {
        params.ExclusiveStartKey = lastEvalValue;
      }
      const res = await dynamoDbLib.call("query", params);
      result = [...result, ...res.Items];
      lastEvalValue = res.LastEvaluatedKey;
    } while (typeof lastEvalValue !== "undefined" && result.length < 100);

    // const result = await dynamoDbLib.call("query", params);

    // Function from given code
    const filtered = result.slice(0, 100).sort((a, b) => {
      // Calculates the age of the article in seconds
      const ageA = currentDate - a.addedTS;
      const ageB = currentDate - b.addedTS;
      // Adjusts the age factor (A’) so that:
      // - For the first 24 hours, A’ decreases linearly from 86401 to 1
      // - After 24 hours, A’ remains constant at 1
      const A_A = Math.max(1, day - ageA);
      const A_B = Math.max(1, day - ageB);
      // Sorting formula: (Age factor * Number of comments)
      // - Newer articles get higher weight during the first 24h.
      // - Older articles (>1 day) have a fixed weight where only the number of comments matters.
      if (A_A * a.msgCount > A_B * b.msgCount) return -1; // Place a before b if a’s weight is higher
      if (A_A * a.msgCount < A_B * b.msgCount) return 1; // Place b before a if b’s weight is higher
      return 0; // Maintain the current order if they have the same weight
    });

    const toReturn = filtered.map((art) => {
      const ageA = currentDate - art.addedTS;
      const A_A = Math.max(1, day - ageA);

      const trendValue = `${new Intl.NumberFormat("en-US")
        .format(A_A)
        .replace(/,/g, " ")} x ${art.msgCount} = ${new Intl.NumberFormat(
        "en-US"
      )
        .format(A_A * art.msgCount)
        .replace(/,/g, " ")}`;
      return {
        ...art,
        trendValue: trendValue,
        trust: {
          amount: art.trust.users.length,
          status: art.trust.users.includes(userId),
        },
        distrust: {
          amount: art.distrust.users.length,
          status: art.distrust.users.includes(userId),
        },
        likes: {
          amount:
            typeof art.interestCount === "number"
              ? art.interestCount
              : art.likes && art.likes.users
              ? art.likes.users.length
              : 0,
          status:
            art.likes && art.likes.users
              ? art.likes.users.includes(userId)
              : false,
        },
        dislikes: {
          amount:
            typeof art.uninterestCount === "number"
              ? art.uninterestCount
              : art.dislikes && art.dislikes.users
              ? art.dislikes.users.length
              : 0,
          status:
            art.dislikes && art.dislikes.users
              ? art.dislikes.users.includes(userId)
              : false,
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
