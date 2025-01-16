//import AWS from "aws-sdk";
import * as dynamoDbLib from "../libs/dynamodb-lib";

import { success, failure } from "../libs/response-lib";

const LOCAL_DEBUG = false;

export async function main(event, context) {
  const userId = event.requestContext.identity.cognitoIdentityId;

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

  const itemsToReturn = items.map((article) => {
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
