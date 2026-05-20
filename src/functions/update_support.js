import handler from "../libs/handler-lib";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import { sendPushNotificationToClient } from "../libs/push_notifications_util";
// update notification function
// This function updates the user's notifications in the database
async function updateUserNotifications(rssUrl, url, title, commentId, parentUserId, username, notificationType) {
  const notification = {
      timestamp: Math.floor(new Date().getTime() / 1000),
      read: false,
      seen: false,
      rssUrl,
      url,
      title,
      commentId,
      username,
      notificationType
  };
  const params = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
          id: "notifications",
          sortKey: parentUserId,
      },
      ExpressionAttributeNames: {
          "#notification_name": notificationType
      },
      ExpressionAttributeValues: {
          ":notification": [notification],
          ":empty_list": [],
      },
      UpdateExpression: `SET #notification_name = list_append(if_not_exists(#notification_name, :empty_list), :notification)`,
      ReturnValues: "ALL_NEW",
  };

  try {
      await dynamoDbLib.call("update", params);
      console.log('Notification Row Added');
  } catch (e) {
      console.log("something went wrong when adding notification row, put error:" + e.message);
      return false;
  }
}

export const main = handler(async (event, context) => {
  const data = JSON.parse(event.body);
  console.log("SENT DATA ***", data);

  const params = {
    userId: event.requestContext.identity.cognitoIdentityId || data.userId,
    type: event.pathParameters.type,
  };

  let res;

  if (params.type === "comments") {
    const commentQuery = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: data.content.url + "#msg",
        sortKey: data.content.sortKey,
      },
      ExpressionAttributeNames: {
        "#support": "support",
      },
      ExpressionAttributeValues: {
        ":userId": [params.userId],
        ":empty_list": [],
      },
      UpdateExpression: `SET #support = list_append(if_not_exists(#support, :empty_list), :userId)`,
      ReturnValues: "ALL_NEW",
    };

    res = await dynamoDbLib.call("update", commentQuery);

    res = {
      ...res.Attributes,
      support: {
        amount: res.Attributes.support.length,
        status: res.Attributes.support.includes(params.userId),
      },
    };

  } else if (params.type === "articles") {
    const articleQuery = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: data.content.url,
        sortKey: data.content.source,
      },
      ExpressionAttributeNames: {
        "#support": "support",
      },
      ExpressionAttributeValues: {
        ":userId": [params.userId],
        ":empty_list": [],
      },
      UpdateExpression: `SET #support = list_append(if_not_exists(#support, :empty_list), :userId)`,
      ReturnValues: "ALL_NEW",
    };

    res = await dynamoDbLib.call("update", articleQuery);

    res = {
      ...res.Attributes,
      support: {
        amount: res.Attributes.support.length,
        status: res.Attributes.support.includes(params.userId),
      },
      subjects: res.Attributes.subjects.map((subject) => {
        return {
          id: subject.id,
          users: subject.users.length,
          status: subject.users.includes(params.userId),
        };
      }),
    };
  }

  let recipientProfileData = await dynamoDbLib.getUserProfileData(
    res.userId
  );

  let ProfileData = await dynamoDbLib.getUserProfileData(
    params.userId
  );
  console.log("===comment===recipientProfileData=======", recipientProfileData);
  await updateUserNotifications(
    data.content.source,
    data.content.url,
    data.content.title,
    data.content.sortKey.split("#")[1],
    res.userId,
    ProfileData.nickname,
    "comment_supported"
  );
  if (recipientProfileData !== null) {
    console.log(
      "sending push notification to user tokens: " +
        recipientProfileData.expoTokens
    );
    if (
      recipientProfileData.expoTokens === null ||
      recipientProfileData.expoTokens === undefined
    ) {
      console.error("no expoTokens at: " + data.parentUserId);
    } else {
      let messageBody = ProfileData.nickname +" använde din kommentar som ett belägg";

      let receiptIds = await sendPushNotificationToClient(
        data.parentUserId,
        recipientProfileData.expoTokens,
        messageBody
      );
      console.log("receiptIds for push notifications: " + receiptIds);
    }
  } else {
    console.log(
      "failed to llok up profile for recipient of PN: " + data.parentUserId
    );
  }

  //end code
  const typeCapitalized =
    params.type.charAt(0).toUpperCase() + params.type.slice(1);

  const query = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: `support${typeCapitalized}`,
      sortKey: params.userId,
    },
    ExpressionAttributeNames: { "#content": "content" },
    ExpressionAttributeValues: {
      ":empty_list": [],
      ":new_support": [data.content],
    },
    UpdateExpression:
      "SET #content = list_append(if_not_exists(#content, :empty_list), :new_support)",
    ReturnValues: "ALL_NEW",
  };

  await dynamoDbLib.call("update", query);
  return res;
});
