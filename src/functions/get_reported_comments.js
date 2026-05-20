import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import handler from "../libs/handler-lib";

export const main = handler(async (event, context) => {
  const userId = event.requestContext.identity.cognitoIdentityId;
  console.log("REPORTED RESULT", userId);
  if (!userId) return;

  const adminsQuery = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "users",
      sortKey: "auth",
    },
  };

  const result = await dynamoDbLib.call("get", adminsQuery);

  const authed = result.Item.admin.includes(userId);

  if (authed) {
    const reportedCommentsQuery = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: "comments",
        sortKey: "reported",
      },
    };

    const result = await dynamoDbLib.call("get", reportedCommentsQuery);

    if (!Object.keys(result).length)
      return { status: 200, reportedComments: [] };

    return { status: 200, reportedComments: result.Item.entries };
  } else {
    return { status: 401, message: "unauthorized" };
  }
});
