//import AWS from "aws-sdk";
import * as defs from "../libs/defs";
import * as dynamoDbLib from "../libs/dynamodb-lib";

import { success, failure } from "../libs/response-lib";

const LOCAL_DEBUG = false;

export async function main(event, context) {
  const userId = event.requestContext?.identity?.cognitoIdentityId ?? null;

  let pathParamData;
  // TODO: Rename 'url' to something else, it's actually a data chunk now with more than just a url (but this requires reploying the API definition)
  if (event.pathParameters && event.pathParameters.url != null) {
    let uriDecodedJsonData = decodeURIComponent(event.pathParameters.url);
    pathParamData = JSON.parse(uriDecodedJsonData);
  }

  let rssUrl = pathParamData.rssUrl;

  //
  // Query the DB for RSS article entries
  //
  let items = await dynamoDbLib.doQueryNewsFeed(rssUrl);

  const itemsToReturn = await Promise.all(
    items.map(async (article) => {
      const articleUrl = article.id;
      const dbKey = articleUrl + "#msg";

      const cmtParams = {
        TableName: defs.WN_STR_KEY_TABLE,
        KeyConditionExpression: "id = :id",
        ExpressionAttributeValues: {
          ":id": dbKey,
        },
      };

      const cmtResult = await dynamoDbLib.call("query", cmtParams);
      let fixedItems = [];
      if (cmtResult && cmtResult.Items) {
        fixedItems = cmtResult.Items.filter(
          (comment) => comment.deleted === false
        ).map((comment) => ({
          ...comment,
          support: {
            amount: comment.support.length,
            status: comment.support.includes(userId),
          },
        }));
      }

      return {
        ...article,
        comments: fixedItems.length,
        trust: {
          amount: article.trust.users.length,
          status: article.trust.users.includes(userId),
        },
        distrust: {
          amount: article.distrust.users.length,
          status: article.distrust.users.includes(userId),
        },
        likes: {
          amount:
            typeof article.interestCount === "number"
              ? article.interestCount
              : article.likes && article.likes.users
              ? article.likes.users.length
              : 0,
          status:
            article.likes && article.likes.users
              ? article.likes.users.includes(userId)
              : false,
        },
        dislikes: {
          amount:
            typeof article.uninterestCount === "number"
              ? article.uninterestCount
              : article.dislikes && article.dislikes.users
              ? article.dislikes.users.length
              : 0,
          status:
            article.dislikes && article.dislikes.users
              ? article.dislikes.users.includes(userId)
              : false,
        },
        support: {
          amount: article.support.length,
          status: article.support.includes(userId),
        },
        subjects: article.subjects.map((subject) => ({
          id: subject.id,
          users: subject.users.length,
          status: subject.users.includes(userId),
        })),
      };
    })
  );

  if (items) {
    if (LOCAL_DEBUG) {
      return success({
        status: true,
        items: `Tmp disabled during local development, showing items len: ${items.length}`,
        channelHeader: {},
      });
    } else {
      return success({ status: true, items: itemsToReturn, channelHeader: {} });
    }
  } else {
    return failure({
      status: false,
      error: "Query seems to have returned empty result.",
    });
  }
}
