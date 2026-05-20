import handler from "../libs/handler-lib";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";

export const main = handler(async (event, context) => {
  const body = JSON.parse(event.body);

  const userId = event.requestContext.identity.cognitoIdentityId;
  const nickname = body.nickname;
  const profilePic = body.profilePic;
  const imageKey = body.imageKey;
  const subId = body.subId;
  const email = body.email;
  const toggleValues = body.toggleValues;

  const ttlTSVal = dynamoDbLib.ttlTS(defs.TTL_SET_PROFILE_AFTER_UPDATE);

  const composedKey = "profile#" + userId;

  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: composedKey,
      sortKey: defs.DB_PROFILE_SORT_KEY,
    },
    UpdateExpression:
      "SET nickname = :nickname, pic = :pic, userId = :userId, amount = :amount, toggleValues = :toggleValues, ttlTS = :ttlTS, ttlDbg = :ttlDbg, image = :image, subId = :subId, email = :email",
    ExpressionAttributeValues: {
      ":nickname": nickname,
      ":pic": profilePic,
      ":image": imageKey,
      ":userId": userId,
      ":amount": dynamoDbLib.now(), // Store 'amount', just so that we'll be able to query all profiles from the GSI
      ":toggleValues": toggleValues,
      ":ttlTS": ttlTSVal,
      ":ttlDbg": dynamoDbLib.tsToDbgStr(ttlTSVal),
      ":subId": subId,
      ":email": email,
    },
    ReturnValues: "ALL_NEW",
  };

  const result = await dynamoDbLib.call("update", params);
  return { status: true, item: result.Attributes };
});
