import handler from "../libs/handler-lib";
import { JSONPath } from "jsonpath-plus";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import jsonDiff from "json-diff";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const sns = new SNSClient({});

const config = {
  matchers: [
    {
      description: "comment liked",
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
      sns_publish_to: "comment_marked_reliable",
      diff_path: '$.feedback.M.reliable.M.users.L[?(@[0]=="+")][?(@.S)].S',
    },
    {
      description: "comment unreliable (Not trustworthy)",
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
        const publishResult = await sns.send(new PublishCommand({
          TopicArn:
            process.env.snsTopicArnPrefix + ":" + process.env.snsTopicNamePrefix + matcher.sns_publish_to,
          Message: JSON.stringify(eventData),
          MessageStructure: "string",
        }));

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
  return true;
}

export const getEventData = async (input, diff_path) => {
  if (!match(input, diff_path)) {
    console.log("getEventData NOT MATCHED", JSON.stringify(input, null, 2));
    return {};
  }

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
      commentSortKey: input.NewImage.sortKey.S,
      timestamp: input.ApproximateCreationDateTime,
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
  let parsed = JSONPath({ path: diff_path, json: diff, resultType: "value" });
  return parsed;
}
