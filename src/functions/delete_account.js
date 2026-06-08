import { CognitoIdentityProviderClient, AdminDeleteUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import handler from "../libs/handler-lib";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";

const cognito = new CognitoIdentityProviderClient({});

export const main = handler(async (event, context) => {
  let userId = event.requestContext.identity.cognitoIdentityId;
  const body = JSON.parse(event.body);
  const userPoolID = body.user_pool_id || defs.user_pool_id;
  if (body.userId) {
    const adminsQuery = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: "users",
        sortKey: "auth",
      },
    };

    const result = await dynamoDbLib.call("get", adminsQuery);
    const authed =
      result.Item.admin.includes(userId) || userId !== result.Item.userId;

    if (!authed) return { status: 401, message: "unauthorized" };

    const params = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: `profile#${body.userId}`,
        sortKey: "profile",
      },
    };
    const userToDelete = await dynamoDbLib.call("get", params);
    if (!userToDelete || !userToDelete.Item) return { status: 200, message: "account already deleted" };
    const deleteParams = {
      UserPoolId: userPoolID,
      Username: userToDelete.Item.subId,
    };

    try {
      const data = await cognito.send(new AdminDeleteUserCommand(deleteParams));
      console.log("account should be deleted,", data);
    } catch (err) {
      console.log("something weird happened!!!!", err);
      return { message: "something weird happened:", err };
    }

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
    console.log(userAccountResult);
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
      KeyConditionExpression: "id = :id",
      ExpressionAttributeValues: {
        ":id": `${userId}#personalValues`,
      },
    };
    const userPersonalValuesResult = await dynamoDbLib.call(
      "query",
      userPersonalValuesParams
    );

    for (const item of userPersonalValuesResult.Items || []) {
      await dynamoDbLib.call("delete", {
        TableName: defs.WN_STR_KEY_TABLE,
        Key: {
          id: item.id,
          sortKey: item.sortKey,
        },
      });
    }

    await dynamoDbLib.call("delete", {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: "personalValues",
        sortKey: userId,
      },
    });

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
      IndexName: "sortKey-amount-index",
      ExpressionAttributeValues: {
        ":sortKey": userId,
      },
      KeyConditionExpression: "sortKey = :sortKey",
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
      error: e.message,
    };
  }
});
