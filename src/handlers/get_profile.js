import * as dynamoDbLib from "../libs/dynamodb-lib";
import { success, failure } from "../libs/response-lib";
import * as defs from "../libs/defs";

export async function main(event, context) {
  //const data = JSON.parse(event.body);

  let userId = event.requestContext.identity.cognitoIdentityId;

  const getValuesParams = {
    TableName: defs.WN_STR_KEY_TABLE,
    KeyConditionExpression: "id = :id",
    ExpressionAttributeValues: {
      ":id": `${userId}#personalValues`,
    },
  };

  const values = await dynamoDbLib.call("query", getValuesParams);

  const legacyValuesParams = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "personalValues",
      sortKey: userId,
    },
  };
  const legacyValues = await dynamoDbLib.call("get", legacyValuesParams);

  if (
    (!values.Items || values.Items.length === 0) &&
    !(legacyValues.Item && Array.isArray(legacyValues.Item.subjects))
  ) {
    const updateValuesParams = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: `${userId}#personalValues`,
        sortKey: "88",
      },
      ExpressionAttributeNames: {
        "#value": "value",
        "#timeStamp": "timeStamp",
      },
      ExpressionAttributeValues: {
        ":value": 1,
        ":timeStamp": Math.floor(new Date().getTime() / 1000),
      },
      UpdateExpression: "SET #value = :value, #timeStamp = :timeStamp",
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
