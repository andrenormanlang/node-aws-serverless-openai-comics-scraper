import * as dynamoDbLib from "../libs/dynamodb-lib";
import { success, failure } from "../libs/response-lib";
import * as defs from "../libs/defs";

export async function main(event, context) {
  const data = event.queryStringParameters;

  const followingUserId = data.followingUserId;

  //logged in user
  let userId = event.requestContext.identity.cognitoIdentityId;

  //get logged in user's data
  let profileData = await dynamoDbLib.getUserProfileData(userId);

  //check if user exists
  if (profileData === null) {
    return failure({
      status: false,
      error: "Profile not found",
      errorCode: defs.ERROR_CODE_NO_PROFILE,
    });
  }

  let isFollow = await dynamoDbLib.checkFollower(userId, followingUserId);

  if (isFollow) {
    return success({
      status: true,
    });
  } else {
    return success({
      status: false,
    });
  }
}
