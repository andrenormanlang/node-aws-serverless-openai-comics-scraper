import handler from "../libs/handler-lib";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";

export const main = handler(async (event, context) => {
  const data = JSON.parse(event.body);

  const userId = event.requestContext.identity.cognitoIdentityId;

  const adminsQuery = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "users",
      sortKey: "auth",
    },
  };

  const result = await dynamoDbLib.call("get", adminsQuery);
  console.log("Result**", result);
  const authed =
    result.Item.admin.includes(userId) || userId !== result.Item.userId;

  if (!authed) return { status: 401, message: "unauthorized" };

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
    },
    UpdateExpression: `SET #deleted = :deleted, #userNickname = :userNickname, #userPic = :userPic, #image = :image, #subjectPts = :subjectPts, #msg = :msg`,
    ReturnValues: "ALL_NEW",
  };

  const removedMessage = await dynamoDbLib.call("update", messageToRemove);
  return { result: removedMessage.Attributes };
});
