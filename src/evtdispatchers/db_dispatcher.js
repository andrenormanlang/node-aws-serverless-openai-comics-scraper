import handler from "../libs/handler-lib";
import { JSONPath } from "jsonpath-plus";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import jsonDiff from "json-diff";
import AWS from "aws-sdk";

const sns = new AWS.SNS();

const config = {
  matchers: [
    {
      description: "comment liked",
      // "matcher": require("../evtmatchers/comment_liked"),
      sns_publish_to: "comment_liked",
      diff_path: '$.feedback.M.likes.M.users.L[?(@[0]=="+")][?(@.S)].S',
    },
    {
      description: "comment disliked",
      sns_publish_to: "comment_disliked",
      diff_path: '$.feedback.M.dislikes.M.users.L[?(@[0]=="+")][?(@.S)].S',
    },
    {
      description: "comment reliable (trustworthy)",
      // "matcher": require("../evtmatchers/comment_reliable"),
      sns_publish_to: "comment_marked_reliable",
      diff_path: '$.feedback.M.reliable.M.users.L[?(@[0]=="+")][?(@.S)].S',
    },
    {
      description: "comment unreliable (Not trustworthy)",
      // "matcher": require("../evtmatchers/comment_reliable"),
      sns_publish_to: "comment_marked_unreliable",
      diff_path: '$.feedback.M.unreliable.M.users.L[?(@[0]=="+")][?(@.S)].S',
    },
    {
      description: "Use as argument: comment used as argument",
      matcher: require("../evtmatchers/comment_supported"),
      sns_publish_to: "comment_supported",
    },
  ],
};

export const main = handler(async (event, context) => {
  let parsed = JSONPath({
    path: "$.Records[*].dynamodb",
    json: event,
    resultType: "value",
  });
  for (const dbEvent of parsed) {
    console.log("dbEvent **", dbEvent);
    console.log("checking dbEvent: ", JSON.stringify(dbEvent, null, 2));
    for (const matcher of config.matchers) {
      let matched =
        matcher.matcher !== undefined
          ? matcher.matcher.matched(dbEvent)
          : match(dbEvent, matcher.diff_path);
      console.log("matcher: ", matcher.description, "matched: ", matched);
      if (matched) {
        const eventData =
          matcher.matcher !== undefined
            ? await matcher.matcher.getEventData(dbEvent)
            : await getEventData(dbEvent, matcher.diff_path);

        console.log("PUBLISHING MESSAGE", eventData);
        const publishResult = await sns
          .publish({
            // Get the topic from the environment variable
            TopicArn:
              process.env.snsTopicArnPrefix + ":" + process.env.snsTopicNamePrefix + matcher.sns_publish_to,
            Message: JSON.stringify(eventData),
            MessageStructure: "string",
          })
          .promise();

        console.log(
          `PUBLISH RESULT: ${JSON.stringify(publishResult, null, 2)}`
        );
      }
    }
  }

  return "Done";
});

function match(input, diff_path) {
  console.log("got input: ", JSON.stringify(input, null, 2));

  if (!input.NewImage.id.S.endsWith("#msg")) {
    return false;
  }
  let parsed = getInitiatingUserId(input, diff_path);

  if (!parsed || parsed.length === 0) {
    return false;
  }
  // console.log(JSON.stringify(parsed, null, 2));
  return true;
}

export const getEventData = async (input, diff_path) => {
  if (!match(input, diff_path)) {
    console.log("getEventData NOT MATCHED", JSON.stringify(input, null, 2));
    return {};
  }

  // data to be collected:
  // -- commentId (String) - right part of sortKey - the one after the '#' sign (format: GUID).
  //      example: sortKey of comment is 03285320-b7da-11eb-b209-2573d4fd34ee#b8cb0520-c53a-11eb-bdd5-a94db61c465c
  //               then commentId is                                          b8cb0520-c53a-11eb-bdd5-a94db61c465c
  // -- timestamp (Number) - event timestamp
  // -- title (String) - Article title
  // -- url (String) - article url. globally used as identifier. suffexed with #msg becomes partitionKey of comment (where sortKey points to specific comment - commentId above)
  // -- username (String) - user who triggered the event
  let url = input.NewImage.id.S.split("#")[0];
  let sortKey = input.NewImage.rssUrl.S;
  const getArticleParams = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: url,
      sortKey: sortKey,
    },
  };
  console.log("NEWSORTKEY ** from Tariq", sortKey);

  try {
    const initiatingUserId = getInitiatingUserId(input, diff_path)[0];
    const initiatingUserProfile = await dynamoDbLib.getUserProfileData(
      initiatingUserId
    );
    const article = await dynamoDbLib.call("get", getArticleParams);
    console.log("article: ", article);
    const eventData = {
      commentId: input.NewImage.sortKey.S.split("#")[1],
      commentSortKey: input.NewImage.sortKey.S, // this and url uniquily identifies comment in database for any event handler to have all information
      timestamp: input.ApproximateCreationDateTime, // event timestamp
      title: article.Item.title,
      rssUrl: input.NewImage.rssUrl.S,
      url: url,
      username: initiatingUserProfile.nickname,
    };
    return eventData;
  } catch (e) {
    console.log(`getEventData error: `, e);
  }

  return {};
};

function getInitiatingUserId(input, diff_path) {
  let diff = jsonDiff.diff(input.OldImage, input.NewImage);

  // https://jsonpath.com - use this site to validate path value below against mocked json
  let parsed = JSONPath({ path: diff_path, json: diff, resultType: "value" });
  return parsed;
}
