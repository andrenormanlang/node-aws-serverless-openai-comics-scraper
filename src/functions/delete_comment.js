import handler from "../libs/handler-lib";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";

export const main = handler(async (event, context) => {
  let data = {};
  try {
    data = JSON.parse(event.body || "{}");
  } catch (e) {
    return { status: 400, message: "invalid json body" };
  }

  const userId = event.requestContext.identity.cognitoIdentityId;

  if (!userId || !data.id || !data.sortKey) {
    return { status: 400, message: "missing id or sortKey" };
  }

  const adminsQuery = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "users",
      sortKey: "auth",
    },
  };

  const result = await dynamoDbLib.call("get", adminsQuery);
  console.log("Result**", result);

  const commentQuery = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: data.id,
      sortKey: data.sortKey,
    },
  };

  const commentResult = await dynamoDbLib.call("get", commentQuery);
  if (!commentResult || !commentResult.Item) {
    return { status: 404, message: "comment not found" };
  }

  const isAdmin =
    result &&
    result.Item &&
    Array.isArray(result.Item.admin) &&
    result.Item.admin.includes(userId);
  const isOwner = commentResult.Item.userId === userId;
  const authed = isAdmin || isOwner;

  if (!authed) return { status: 401, message: "unauthorized" };

  if (commentResult.Item.deleted === true) {
    return { result: commentResult.Item, alreadyDeleted: true };
  }

  const messageToRemove = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: data.id,
      sortKey: data.sortKey,
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
      ":deletedFalse": false,
    },
    UpdateExpression: `SET #deleted = :deleted, #userNickname = :userNickname, #userPic = :userPic, #image = :image, #subjectPts = :subjectPts, #msg = :msg`,
    ConditionExpression:
      "attribute_not_exists(#deleted) OR #deleted = :deletedFalse",
    ReturnValues: "ALL_NEW",
  };

  let removedMessage;
  try {
    // Only the first delete call should mutate state to keep decrement idempotent.
    removedMessage = await dynamoDbLib.call("update", messageToRemove);
  } catch (e) {
    if (e.code === "ConditionalCheckFailedException") {
      const currentComment = await dynamoDbLib.call("get", commentQuery);
      if (currentComment && currentComment.Item) {
        return { result: currentComment.Item, alreadyDeleted: true };
      }
      return { status: 409, message: "comment already deleted" };
    }
    throw e;
  }

  const articleUrl = data.id.endsWith("#msg")
    ? data.id.slice(0, -4)
    : data.id.replace(/#msg$/, "");

  const decrementParams = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: articleUrl,
      sortKey: "articles",
    },
    UpdateExpression: "SET msgCount = msgCount - :one",
    ExpressionAttributeValues: {
      ":one": 1,
      ":expectedId": articleUrl,
    },
    ConditionExpression:
      "id = :expectedId AND attribute_exists(msgCount) AND msgCount >= :one",
    ReturnValues: "UPDATED_NEW",
  };

  try {
    await dynamoDbLib.call("update", decrementParams);
  } catch (e) {
    console.error("delete_comment: failed to decrement msgCount", e.message);
  }

  return { result: removedMessage.Attributes };
});
