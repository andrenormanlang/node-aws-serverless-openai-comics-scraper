import * as dynamoDbLib from "../libs/dynamodb-lib";
import { success, failure } from "../libs/response-lib";
import * as defs from "../libs/defs";

export async function main(event, context) {
  const data = JSON.parse(event.body);

  let userId = event.requestContext.identity.cognitoIdentityId;
  let nickname = data.nickname;
  let profilePic = data.profilePic;
  let subId = data.subId;
  let email = data.email;
  let toggleValues = false;

  if (data == null) {
    let msg = "Json body is null";
    console.log(msg);
    return failure({ status: false, message: msg });
  } else if (nickname == null) {
    let msg = "nickname is null";
    console.log(msg);
    return failure({ status: false, message: msg });
  } else if (profilePic == null) {
    let msg = "profilePic is null";
    console.log(msg);
    return failure({ status: false, message: msg });
  } else if (userId === null) {
    let msg = "cognitoIdentityId is null";
    console.log(msg);
    return failure({ status: false, message: msg });
  }

  console.log("* got this data:");
  console.log({
    nickname: nickname,
    profilePic: profilePic,
    userId: userId,
    toggleValues: toggleValues,
  });

  const ttlTSVal = dynamoDbLib.ttlTS(defs.TTL_SET_PROFILE_AFTER_UPDATE);

  let composedKey = "profile#" + userId;

  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    // 'Key' defines the partition key and sort key of the item to be updated
    // - 'userId': Identity Pool identity id of the authenticated user
    // - 'noteId': path parameter
    Key: {
      id: composedKey,
      sortKey: defs.DB_PROFILE_SORT_KEY,
    },

    // 'UpdateExpression' defines the attributes to be updated
    // 'ExpressionAttributeValues' defines the value in the update expression
    // // NOTE: This will fail mysteriously if both args aren't number data types!
    UpdateExpression:
      "SET " +
      "nickname = :nickname" +
      ",pic = :pic" +
      ",userId = :userId" +
      ",amount = :amount" +
      ",toggleValues = :toggleValues" +
      ", ttlTS = :ttlTS, ttlDbg = :ttlDbg, subId = :subId, email = :email",
    ExpressionAttributeValues: {
      ":nickname": nickname,
      ":pic": profilePic,
      ":userId": userId,
      ":amount": dynamoDbLib.now(), // Store 'amount', just so that we'll be able to query all profiles from the GSI
      ":toggleValues": toggleValues,
      ":ttlTS": ttlTSVal,
      ":ttlDbg": dynamoDbLib.tsToDbgStr(ttlTSVal),
      ":subId": subId,
      ":email": email,
    },
    // 'ReturnValues' specifies if and how to return the item's attributes,
    // where ALL_NEW returns all attributes of the item after the update; you
    // can inspect 'result' below to see how it works with different settings
    //ReturnValues: "ALL_NEW"
    ReturnValues: "ALL_NEW",
  };

  try {
    const result = await dynamoDbLib.call("update", params);
    //console.log("DDB update result: ");
    //console.log(result);
    //console.log("* DONE");
    return success({ status: true, item: result.Attributes });
  } catch (e) {
    console.error("set_profile, Error: " + e.message);
    return failure({ status: false, message: "Update failed" });
  }

  //return success({ status: true, nick_name: data.nick_name, profile_pic: data.profile_pic });
}
