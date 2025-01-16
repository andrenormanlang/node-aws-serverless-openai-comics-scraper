import * as dynamoDbLib from "../libs/dynamodb-lib";
import { success, failure } from "../libs/response-lib";
import * as defs from "../libs/defs";

export async function main(event, context) {
  //const data = JSON.parse(event.body);

  let userId = event.requestContext.identity.cognitoIdentityId;

  const getValuesParams = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "personalValues",
      sortKey: userId,
    },
  };

  const values = await dynamoDbLib.call("get", getValuesParams);

  if (!Object.keys(values).length) {
    const updateValuesParams = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: "personalValues",
        sortKey: userId,
      },
      ExpressionAttributeNames: {
        "#subjects": "subjects",
      },
      ExpressionAttributeValues: {
        ":values": [{ subjectId: 88, value: 1 }],
      },
      UpdateExpression: `SET #subjects = :values`,
      ReturnValues: "ALL_NEW",
    };

    await dynamoDbLib.call("update", updateValuesParams);
  }

  /*if (data == null ) {
    let msg = "Json body is null";
    console.log(msg);
    return failure({ status: false, message: msg });
  } else */
  if (userId === null) {
    let msg = "cognitoIdentityId is null";
    console.log(msg);
    return failure({ status: false, message: msg });
  }

  let profileData = await dynamoDbLib.getUserProfileData(userId);

  if (profileData) {
    console.log("get_profile success");
    return success({ status: true, item: profileData });
  } else {
    console.error("get_profile, failed to fetch profile data");
    return failure({ status: false, error: "Profile not found" });
  }
}
