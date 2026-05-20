import handler from "../libs/handler-lib";
import * as dynamoDbLib from "../libs/dynamodb-lib";

export const main = handler(async (event, context) => {
  console.log(JSON.stringify(event));
  const userId = decodeURIComponent(event.pathParameters.userId);
  console.log(`event.pathParameters.userId: ${userId}`);

  let profileData = await dynamoDbLib.getUserProfileData(userId);

  if (profileData) {
    console.log("find_profile success");
    return profileData;
  } else {
    console.error("find_profile, failed to fetch profile data");
    return { status: false, error: "Profile not found" };
  }
});
