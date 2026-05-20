import * as dynamoDbLib from "../libs/dynamodb-lib";
import { success, failure } from "../libs/response-lib";
import * as defs from "../libs/defs";

async function updateUserProfile(userId, expoTokens) {
  console.log({ userId: userId, expoTokens: expoTokens });
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
      "SET " + "expoTokens = :expoTokens" + ",ttlTS = :ttlTS, ttlDbg = :ttlDbg",
    ExpressionAttributeValues: {
      ":expoTokens": expoTokens,
      ":ttlTS": ttlTSVal,
      ":ttlDbg": dynamoDbLib.tsToDbgStr(ttlTSVal),
    },
    // 'ReturnValues' specifies if and how to return the item's attributes,
    // where ALL_NEW returns all attributes of the item after the update; you
    // can inspect 'result' below to see how it works with different settings
    //ReturnValues: "ALL_NEW"
    ReturnValues: "ALL_NEW",
  };

  try {
    await dynamoDbLib.call("update", params);
    return true;
  } catch (e) {
    console.error("add_expo_token: updateUserProfile, Error: " + e.message);
    return false;
  }
}

export async function main(event, context) {
  let data = JSON.parse(event.body);
  // let data = event.body;
  // If the body is a string, parse it as JSON
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      console.error('Error parsing JSON body:', e);
      return failure({ status: false, message: 'Invalid JSON body' });
    }
  }

  const { token } = data;
  let user = null;
  console.log(data);
  // Check if requestContext and identity exist
  if (event.requestContext && event.requestContext.identity) {
    user = event.requestContext.identity.cognitoIdentityId;
  }
  // If user is not set from requestContext, use userId
  if (!user) {
    user = data.userId;
  }

  if (!data || !token) {
    let msg = "Json body is null";
    console.log(msg);
    return failure({ status: false, message: msg });
  } else if (!user) {
    let msg = "cognitoIdentityId is null";
    console.log(msg);
    return failure({ status: false, message: msg });
  }

  console.log("add_expo_token: got this data:");
  console.log(data);
  let profileData = await dynamoDbLib.getUserProfileData(user);
  console.log("userdata: " + JSON.stringify(profileData));
  if (profileData === null) {
    console.error("f, failed to look up user: " + user);
    return failure({
      status: false,
      error: "Profile not found",
      errorCode: defs.ERROR_CODE_NO_PROFILE,
    });
  }

  if (profileData.expoTokens === null || profileData.expoTokens === undefined) {
    profileData.expoTokens = [];
  }

  if (!profileData.expoTokens.includes(token)) {
    profileData.expoTokens.push(token);
  } else {
    console.warn("add_expo_token, expo token already added is user profile");
    return success({
      status: true,
      item: profileData.expoTokens,
    });
  }

  let updateResult = await updateUserProfile(user, profileData.expoTokens);
  if (updateResult) {
    return success({ status: true, item: profileData.expoTokens });
  } else {
    console.error("add_expo_token, failed to update user profile");
    return failure({
      status: false,
      error: "Failed to update user profile",
      errorCode: defs.ERROR_CODE_DB_ERROR,
    });
  }
}
