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
  const followingData = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: `profile#${userId}#following`,
      sortKey: followingUserId,
    },
  };

  const followerData = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: `profile#${followingUserId}#follower`,
      sortKey: userId,
    },
  };

  let removeFollowing = await removeData(followingData);
  let removeFollower = await removeData(followerData);

  if (removeFollowing.success && removeFollower.success) {
    return success({
      status: true,
      message: "Removed from the following list",
    });
  } else {
    return failure({
      status: false,
      error: "Failed to unfollow user",
      errorCode: defs.ERROR_CODE_DB_ERROR,
    });
  }
}

/*
Remove followers data from DB
@params - params
@return - Object
*/

async function removeData(params) {
  try {
    await dynamoDbLib.call("delete", params);
    return {
      success: true,
      message: "Removed from the following list",
    };
  } catch (e) {
    return {
      success: false,
      message: "Something went wrong, please try later",
      error: e,
    };
  }
}
