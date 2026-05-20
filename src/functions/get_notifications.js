import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import handler from "../libs/handler-lib";

export const main = handler(async (event, context) => {
  const data = JSON.parse(event.body);
  let userId = null;
  // Check if requestContext and identity exist
  if (event.requestContext && event.requestContext.identity) {
    userId = event.requestContext.identity.cognitoIdentityId;
  }
  // If user is not set from requestContext, use userId
  if (!userId) {
    userId = data.user;
  }
  if (!userId) {
    console.log('user id not found');
    return false;
  };

  if (!userId) return;

  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "notifications",
      sortKey: userId,
    },
  };

  const result = await dynamoDbLib.call("get", params);
  //console.log("result: ", result);
  if (!Object.keys(result).length) {
    return { comments: [] };
  }

  let ret = {};
  if(result.Item.comments !== undefined) {
    ret["comments"] = result.Item.comments.reverse();
  }

  if (result.Item.comment_likes !== undefined) {
    ret["comment_likes"] = result.Item.comment_likes.reverse();
  }
  if (result.Item.comment_dislikes !== undefined) {
    ret["comment_dislikes"] = result.Item.comment_dislikes.reverse();
  }
  if (result.Item.comment_reliable !== undefined) {
    ret["comment_reliable"] = result.Item.comment_reliable.reverse();
  }
  if (result.Item.comment_unreliable !== undefined) {
    ret["comment_unreliable"] = result.Item.comment_unreliable.reverse();
  }
  if (result.Item.comment_supported !== undefined) {
    ret["comment_supported"] = result.Item.comment_supported.reverse();
  }
  if (result.Item.comment_trustworthy !== undefined) {
    ret["comment_trustworthy"] = result.Item.comment_trustworthy.reverse();
  }
  if (result.Item.comment_not_trustworthy !== undefined) {
    ret["comment_not_trustworthy"] =
      result.Item.comment_not_trustworthy.reverse();
  }
  return ret;
});
