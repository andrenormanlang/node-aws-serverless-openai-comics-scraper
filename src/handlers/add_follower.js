import * as dynamoDbLib from "../libs/dynamodb-lib";
import { success, failure, find_missing_params } from "../libs/response-lib";
import * as defs from "../libs/defs";

const REQUIRED_PARAMS = ["followingUserId"];

export async function main(event, context) {
  const data = JSON.parse(event.body);

  //logged in user
  let userId = event.requestContext.identity.cognitoIdentityId;

  let followingUserId = data.followingUserId;

  if (data == null) {
    return failure({ status: false, message: "Json body is null" });
  } else if (userId === null) {
    return failure({ status: false, message: "cognitoIdentityId is null" });
  } else {
    let errMsg = find_missing_params(data, REQUIRED_PARAMS);
    if (errMsg) {
      return failure({ status: false, message: errMsg });
    }
  }

  //get following user's profile
  let followingProfileData = await dynamoDbLib.getUserProfileData(
    followingUserId
  );

  //get logged in user's data
  let profileData = await dynamoDbLib.getUserProfileData(userId);

  //check if user exists
  if (followingProfileData === null || profileData === null) {
    return failure({
      status: false,
      error: "Profile not found",
      errorCode: defs.ERROR_CODE_NO_PROFILE,
    });
  }

  let following = `profile#${userId}#following`;
  let follower = `profile#${followingUserId}#follower`;

  let loggedInUser = {
    userId: userId,
    pic: profileData.pic,
    nickname: profileData.nickname,
  };

  let followingData = setData(followingProfileData, following);
  let followerData = setData(loggedInUser, follower);

  let saveFollowingData = await saveData(followingData);
  let saveFollowerData = await saveData(followerData);

  if (saveFollowingData.success && saveFollowerData.success) {
    return success({ status: true, message: "Added in following list" });
  }
}

/*
Set followers data
@params - userId, pic, nickname
@return - object
*/
function setData(data, composedKey) {
  let followerObj = {
    id: composedKey,
    sortKey: data.userId,
    userPic: data.pic,
    userNickname: data.nickname,
    postedTs: dynamoDbLib.now(),
  };

  return followerObj;
}

/*
Store followers data in DB
@params - data
@return - Promise
*/
async function saveData(data) {
  var params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Item: data,
    ReturnValues: "NONE",
  };

  try {
    await dynamoDbLib.call("put", params);
    return { success: true, message: "Added in following list" };
  } catch (e) {
    return {
      success: false,
      message: "Something went wrong, please try later",
      error: e,
    };
  }
}
