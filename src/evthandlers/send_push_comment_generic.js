import { JSONPath } from "jsonpath-plus";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import { sendPushNotificationToClient } from "../libs/push_notifications_util";

export const main = async (event, context, callback) => {
  console.log("Received event:", JSON.stringify(event, null, 2));
  // send push notification to replied user

  let parsed = JSONPath({
    path: "$.Records[*].Sns.Message",
    json: event,
    resultType: "value",
  });
  // console.log(JSON.stringify(parsed));
  for (const message of parsed) {
    let messageParsed = JSON.parse(message);
    console.log(JSON.stringify(messageParsed, null, 2));

    /*
    const message = {
      commentId:
      commentSortKey:
      timestamp:
      title: // article title
      url: url,
      username:
    };
    */
    let userId = await getUserId(
      messageParsed.url,
      messageParsed.commentSortKey
    );
    let recipientProfileData = await dynamoDbLib.getUserProfileData(userId);
    if (recipientProfileData !== null) {
      console.log(
        "sending push notification to user tokens: " +
          JSON.stringify(recipientProfileData.expoTokens, null, 2)
      );
      if (
        recipientProfileData.expoTokens === null ||
        recipientProfileData.expoTokens === undefined
      ) {
        console.error("no expoTokens at: " + userId);
      } else {
        let messageBody = `${messageParsed.username} ${process.env.pushText}`;
        let receiptIds = await sendPushNotificationToClient(
          userId,
          recipientProfileData.expoTokens,
          messageBody
        );
        console.log(
          "receiptIds for push notifications: " +
            JSON.stringify(receiptIds, null, 2)
        );
      }
    } else {
      console.log("failed to look up profile for recipient of PN: " + userId);
    }
  }

  callback(null, "Success");
};

async function getUserId(url, commentSortKey) {
  const getCommentParams = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: url + "#msg",
      sortKey: commentSortKey,
    },
  };

  console.log(JSON.stringify(getCommentParams));

  const comment = await dynamoDbLib.call("get", getCommentParams);

  return comment.Item.userId;
}
