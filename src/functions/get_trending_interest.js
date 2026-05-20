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
      "#u": "users",
    },
    ExpressionAttributeValues: {
      ":sortKey": data.sortKey,
      ":end_date": endDate,
      ":min_users": 0,
    },
    KeyConditionExpression: "sortKey = :sortKey and addedTS >= :end_date",
    FilterExpression:
      "attribute_exists(likes.#u) AND size(likes.#u) > :min_users",
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

    // Already implemented sort, only optimized it.
    const filtered = result.slice(0, 100).sort((a, b) => {
      // Resolve counts (prefer new counters, fallback to likes/dislikes arrays)
      const aLikes =
        typeof a.interestCount === "number"
          ? a.interestCount
          : a.likes && a.likes.users
          ? a.likes.users.length
          : 0;
      const bLikes =
        typeof b.interestCount === "number"
          ? b.interestCount
          : b.likes && b.likes.users
          ? b.likes.users.length
          : 0;

      // if (aLikes !== bLikes) return bLikes - aLikes; // Sort by likes count first

      const aTotal =
        aLikes +
        (typeof a.uninterestCount === "number"
          ? a.uninterestCount
          : a.dislikes && a.dislikes.users
          ? a.dislikes.users.length
          : 0);
      const bTotal =
        bLikes +
        (typeof b.uninterestCount === "number"
          ? b.uninterestCount
          : b.dislikes && b.dislikes.users
          ? b.dislikes.users.length
          : 0);

      const ageA = currentDate - a.addedTS;
      const ageB = currentDate - b.addedTS;

      const A_A = Math.max(1, day - ageA);
      const A_B = Math.max(1, day - ageB);

      const aScore = aTotal > 0 ? A_A * (aLikes / aTotal) : 0;
      const bScore = bTotal > 0 ? A_B * (bLikes / bTotal) : 0;

      return bScore - aScore; // Sort by weighted score
    });

    const toReturn = filtered.map((art) => {
      const aLikes =
        typeof art.interestCount === "number"
          ? art.interestCount
          : art.likes && art.likes.users
          ? art.likes.users.length
          : 0;
      const aTotal =
        aLikes +
        (typeof art.uninterestCount === "number"
          ? art.uninterestCount
          : art.dislikes && art.dislikes.users
          ? art.dislikes.users.length
          : 0);

      const ageA = currentDate - art.addedTS;
      const A_A = Math.max(1, day - ageA);

      const trendValue = `${new Intl.NumberFormat("en-US")
        .format(A_A)
        .replace(
          /,/g,
          " "
        )} x (${aLikes} / ${aTotal}) = ${new Intl.NumberFormat("en-US")
        .format(A_A * (aLikes / aTotal))
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
    console.log(e);
    return e;
  }
});
