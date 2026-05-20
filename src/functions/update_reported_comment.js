import handler from "../libs/handler-lib";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import uuid from "uuid";

export const main = handler(async (event, context) => {
  const body = JSON.parse(event.body);
  // const userId = event.requestContext.identity.cognitoIdentityId;

  const { reportId = "" } = body;

  const reportedCommentsQuery = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "comments",
      sortKey: "reported",
    },
  };

  const res = await dynamoDbLib.call("get", reportedCommentsQuery);

  let expression;
  let entry;

  if (reportId) {
    const index =
      res &&
      res.Item.entries.findIndex(
        (reportedComment) => body.reportId === reportedComment.reportId
      );
    entry = {
      ...res.Item.entries[index],
      action: body.action,
    };
    expression = `SET #entries[${index}] = :entry`;
  } else {
    entry = [
      {
        reportId: uuid.v1(),
        timestamp: Math.floor(new Date().getTime() / 1000),
        action: false,
        commentId: body.commentId,
        motivation: body.motivation,
        reportedUsername: body.reportedUsername,
        title: body.title,
        url: body.url,
        rssUrl: body.rssUrl,
        reporterUsername: body.username,
      },
    ];

    if (!Object.keys(res).length) {
      expression = "SET #entries = :entry";
    } else {
      expression = "SET #entries = list_append(#entries, :entry)";
    }
  }

  const reportedCommentsUpdateQuery = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "comments",
      sortKey: "reported",
    },
    ExpressionAttributeNames: {
      "#entries": "entries",
    },
    ExpressionAttributeValues: {
      ":entry": entry,
    },
    UpdateExpression: expression,
    ReturnValues: "ALL_NEW",
  };

  try {
    await dynamoDbLib.call("update", reportedCommentsUpdateQuery);
    return { status: 200, message: "success" };
  } catch (e) {
    return { status: 500, message: "internal server error", error: e };
  }
});
