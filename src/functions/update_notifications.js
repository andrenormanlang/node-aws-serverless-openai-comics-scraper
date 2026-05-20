import handler from "../libs/handler-lib";
import * as defs from "../libs/defs";
import * as dynamoDbLib from "../libs/dynamodb-lib";

export const main = handler(async (event, context) => {
  const userId = event.requestContext.identity.cognitoIdentityId;

  const body = JSON.parse(event.body) || {};

  const q = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "notifications",
      sortKey: userId,
    },
  };
  const notif_key = body.type ?? "comments";

  const notifications = await dynamoDbLib.call("get", q);

  if (!Object.keys(notifications).length) return { notif_key: [] };

  if (Object.keys(body).length) {
    let index = notifications.Item[notif_key].findIndex((notification) => {
      if (
        body.notificationId !== undefined &&
        notification.notificationId !== undefined
      )
        return body.notificationId === notification.notificationId;
      return body.commentId === notification.commentId;
    });
    index = index < 0 ? 0 : index;
    const query = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: "notifications",
        sortKey: userId,
      },
      ExpressionAttributeNames: {
        "#notif_type": notif_key,
      },
      ExpressionAttributeValues: {
        ":notification": body,
      },
      UpdateExpression: `SET #notif_type[${index}] = :notification`,
      ReturnValues: "ALL_NEW",
    };

    const result = await dynamoDbLib.call("update", query);
    return { notif_key: result.Attributes[notif_key].reverse() };
  } else {
    // TODO update seen other types of notifications. i.e. notifications.Item.comment_likes and others when added
    const seenNotifications = notifications.Item?.comments.map(
      (notification) => {
        return { ...notification, seen: true };
      }
    );

    const query = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: "notifications",
        sortKey: userId,
      },
      ExpressionAttributeNames: {
        "#comments": "comments",
      },
      ExpressionAttributeValues: {
        ":notifications": seenNotifications,
      },
      UpdateExpression: `SET #comments = :notifications`,
      ReturnValues: "ALL_NEW",
    };

    const result = await dynamoDbLib.call("update", query);
    return { comments: result.Attributes.comments.reverse() };
  }
});
