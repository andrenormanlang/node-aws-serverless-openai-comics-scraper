import * as dynamoDbLib from "../libs/dynamodb-lib";
import { success, failure } from "../libs/response-lib";
import * as defs from "../libs/defs";

export async function main(event, context) {
  const data = event.queryStringParameters;

  const userType = data.userType;

  //logged in user
  let userId = event.requestContext.identity.cognitoIdentityId;

  if (!userType || !["follower", "following"].includes(userType)) {
    return failure({ status: false, message: "Missing parameter" });
  }

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

  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    KeyConditionExpression: "id = :id",
    ExpressionAttributeValues: {
      ":id": `profile#${userId}#${userType}`,
    },
  };

  try {
    let result = await dynamoDbLib.call("query", params);
    if (result && result.Items) {
      return success({ status: true, data: result });
    }
  } catch (e) {
    if (e.code === "ResourceNotFoundException") {
      return failure({ status: false, error: "Oops! no followers found" });
    } else {
      return failure({ status: false, error: "Operation failed" });
    }
  }
}
