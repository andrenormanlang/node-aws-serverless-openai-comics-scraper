import handler from "../libs/handler-lib";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";

export const main = handler(async (event, context) => {
  const AWS = require("aws-sdk");
  const cognito = new AWS.CognitoIdentityServiceProvider({
    region: "eu-central-1",
  });
  const userPoolID = defs.user_pool_id;
  let userId = event.requestContext.identity.cognitoIdentityId;
  const body = JSON.parse(event.body);

  if (body.userId) {
    const adminsQuery = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: "users",
        sortKey: "auth",
      },
    };

    const result = await dynamoDbLib.call("get", adminsQuery);
    const authed = result.Item.admin.includes(userId);

    if (!authed) return { status: 401, message: "unauthorized" };

    const params = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: `profile#${body.userId}`,
        sortKey: "profile",
      },
    };
    const userToDelete = await dynamoDbLib.call("get", params);

    const deleteParams = {
      UserPoolId: userPoolID,
      Username: userToDelete.Item.subId,
    };

    cognito.adminDeleteUser(deleteParams, (err, data) => {
      if (err) {
        console.log("something weird happened!!!!", err);
        return { message: "something weird happened:", err };
      } else {
        console.log("account should be deleted,", data);
      }
    });

    userId = body.userId;
  }

  try {
    const userAccountParams = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: `profile#${userId}`,
        sortKey: "profile",
      },
    };

    const userAccountResult = await dynamoDbLib.call("get", userAccountParams);
    await dynamoDbLib.call("delete", userAccountParams);

    const userSupportCommentsParams = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: `supportComments`,
        sortKey: userId,
      },
    };

    await dynamoDbLib.call("delete", userSupportCommentsParams);

    const userSupportArticlesParams = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: `supportArticles`,
        sortKey: userId,
      },
    };

    await dynamoDbLib.call("delete", userSupportArticlesParams);

    const userPersonalValuesParams = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: `personalValues`,
        sortKey: userId,
      },
    };
    await dynamoDbLib.call("delete", userPersonalValuesParams);

    const userNotifications = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: `notifications`,
        sortKey: userId,
      },
    };
    await dynamoDbLib.call("delete", userNotifications);

    const userMessagesParams = {
      TableName: defs.WN_STR_KEY_TABLE,
      IndexName: "userId-userNickname-index",
      ExpressionAttributeValues: {
        ":userId": userId,
        ":nickname": userAccountResult.Item.nickname,
      },
      KeyConditionExpression: "userId = :userId and userNickname = :nickname",
    };

    const userMessagesResult = await dynamoDbLib.call(
      "query",
      userMessagesParams
    );

    for (let message of userMessagesResult.Items) {
      const messageToRemove = {
        TableName: defs.WN_STR_KEY_TABLE,
        Key: {
          id: message.id,
          sortKey: message.sortKey,
        },
        ExpressionAttributeNames: {
          "#deleted": "deleted",
          "#userNickname": "userNickname",
          "#userPic": "userPic",
          "#image": "image",
          "#subjectPts": "subjectPts",
          "#msg": "msg",
        },
        ExpressionAttributeValues: {
          ":deleted": true,
          ":userNickname": "deleted",
          ":userPic": null,
          ":image": null,
          ":subjectPts": [],
          ":msg": null,
        },
        UpdateExpression: `SET #deleted = :deleted, #userNickname = :userNickname, #userPic = :userPic, #image = :image, #subjectPts = :subjectPts, #msg = :msg`,
        ReturnValues: "ALL_NEW",
      };

      await dynamoDbLib.call("update", messageToRemove);
    }

    return { status: 200, message: "account successfully deleted" };
  } catch (e) {
    return {
      status: 500,
      message:
        "something went wrong, contact admin to make sure all your data gets deleted properly",
    };
  }
});
