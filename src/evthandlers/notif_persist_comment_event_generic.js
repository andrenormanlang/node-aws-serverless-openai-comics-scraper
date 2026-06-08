import { JSONPath } from "jsonpath-plus";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import * as defs from "../libs/defs";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import { updateUserNotifications } from "../libs/notifications_db";
import uuid from "uuid";

const sns = new SNSClient({});

export const main = async (event, context, callback) => {
  console.log("Received event:", JSON.stringify(event, null, 2));
  let parsed = JSONPath({
    path: "$.Records[*].Sns.Message",
    json: event,
    resultType: "value",
  });
  for (const message of parsed) {
    let messageParsed = JSON.parse(message);
    console.log(JSON.stringify(messageParsed, null, 2));
    await saveNotification(messageParsed);
    await sns.send(new PublishCommand({
      TopicArn:
        process.env.snsTopicArnPrefix + ":" + process.env.snsPublishTo,
      Message: JSON.stringify(messageParsed),
      MessageStructure: "string",
    })).catch((reason) => console.log("publish failed, reason: ", reason));
  }

  console.log("Notification added!");

  callback(null, "Success");
};

async function saveNotification(message) {
  const getCommentParams = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: message.url + "#msg",
      sortKey: message.commentSortKey,
    },
  };

  console.log("sk ******* ", message.commentSortKey);

  const comment = await dynamoDbLib.call("get", getCommentParams);

  message["notificationId"] = uuid.v1();

  await updateUserNotifications(
    message,
    comment.Item.userId,
    process.env.notificationName
  );
}
