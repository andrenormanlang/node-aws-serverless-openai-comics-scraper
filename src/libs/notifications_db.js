import * as defs from "../libs/defs";
import * as dynamoDbLib from "../libs/dynamodb-lib";

export async function updateUserNotifications(
  notification,
  userId,
  notificationName
) {
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "notifications",
      sortKey: userId,
    },
    ExpressionAttributeNames: {
      "#notification_name": notificationName,
    },
    ExpressionAttributeValues: {
      ":notification": [notification],
      ":empty_list": [],
    },
    UpdateExpression: `SET #notification_name = list_append(if_not_exists(#notification_name, :empty_list), :notification)`,
    ReturnValues: "ALL_NEW",
  };

  notification["read"] = false;
  notification["seen"] = false;

  try {
    const result = await dynamoDbLib.call("update", params);
    console.log(result);
  } catch (e) {
    console.log(
      "something went wrong when adding notification row, put error:" +
        e.message
    );
    return false;
  }
}
