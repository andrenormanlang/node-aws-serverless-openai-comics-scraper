import * as dynamoDbLib from "../libs/dynamodb-lib";
import { success, failure } from "../libs/response-lib";
import * as defs from "../libs/defs";

export async function main(event, context) {
  let userId = event.requestContext.identity.cognitoIdentityId;
  let pathParamData = null;
  let articleUrl = null;

  if (event.pathParameters && event.pathParameters.body != null) {
    let uriDecodedJsonData = decodeURIComponent(event.pathParameters.body);
    pathParamData = JSON.parse(uriDecodedJsonData);
  }

  console.log("main: Param data for get call:");
  console.log(pathParamData);

  if (pathParamData) {
    articleUrl = pathParamData.url;
  }

  if (userId == null) {
    let msg = "userId is null";
    console.log(msg);
    return failure({ status: false, message: msg });
  } else if (articleUrl === null) {
    let msg = "articleUrl is null";
    console.log(msg);
    return failure({ status: false, message: msg });
  }

  console.log("Query for: " + articleUrl);

  let dbKey = articleUrl + "#msg";

  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    //IndexName: "rss-freshTS-index",
    KeyConditionExpression: "id = :id",
    ExpressionAttributeValues: {
      ":id": dbKey,
    },
  };

  try {
    let result = await dynamoDbLib.call("query", params);

    console.log("result", result);

    if (result && result.Items) {
      const fixedItems = result.Items.map((comment) => {
        comment.subjectPts = comment.subjectPts.map((subject) => {
          return {
            subjectId: subject.subjectId,
            value: subject.value,
            userLikes: subject.userLikes.length,
            userDislikes: subject.userDislikes.length,
          };
        });
        comment.feedback = {
          likes: {
            amount: comment.feedback.likes.users.length,
            status: comment.feedback.likes.users.includes(userId),
          },
          dislikes: {
            amount: comment.feedback.dislikes.users.length,
            status: comment.feedback.dislikes.users.includes(userId),
          },
          reliable: {
            amount: comment.feedback.reliable.users.length,
            status: comment.feedback.reliable.users.includes(userId),
          },
          unreliable: {
            amount: comment.feedback.unreliable.users.length,
            status: comment.feedback.unreliable.users.includes(userId),
          },
        };
        comment.support = {
          amount: comment.support.length,
          status: comment.support.includes(userId),
        };
        return comment;
      });
      return success({ status: true, comments: fixedItems });
    } else {
      console.log("Query returned empty result.");
      return success({ status: true, comments: [] });
    }
  } catch (e) {
    if (e.code === "ResourceNotFoundException") {
      console.log("Query error: ResourceNotFoundException");
      return failure({ status: false, error: "No comments for this article" });
    } else {
      console.log("Query error: ");
      console.log(e);
      return failure({ status: false, error: "Operation failed" });
    }
  }
}
