import * as dynamoDbLib from "../libs/dynamodb-lib";
import uuid from "uuid";
import { success, failure, find_missing_params } from "../libs/response-lib";
import * as defs from "../libs/defs";
import { sendPushNotificationToClient } from "../libs/push_notifications_util";

async function saveComment(newEntry) {
  console.log("newEntry is: ", newEntry);
  var params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Item: newEntry,
    ReturnValues: "NONE",
  };

  try {
    await dynamoDbLib.call("put", params);
    return {
      url: newEntry.id.slice(0, -4),
      title: "temp title",
      commentId: newEntry.sortKey.split("#")[1],
    };
  } catch (e) {
    console.log("add_comment.saveComment, put error:" + e.message);
    return false;
  }
}

async function updateUserNotifications(
  rssUrl,
  url,
  title,
  commentId,
  parentUserId,
  username,
  notificationType,
) {
  /*

    commentId is the id of the comment that has recieved a reply
    commentUserId

  */

  const notification = {
    timestamp: Math.floor(new Date().getTime() / 1000),
    read: false,
    seen: false,
    rssUrl,
    url,
    title,
    commentId,
    username,
  };

  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "notifications",
      sortKey: parentUserId,
    },
    ExpressionAttributeNames: {
      "#comments": notificationType,
    },
    ExpressionAttributeValues: {
      ":notification": [notification],
      ":empty_list": [],
    },
    UpdateExpression: `SET #comments = list_append(if_not_exists(#comments, :empty_list), :notification)`,
    ReturnValues: "ALL_NEW",
  };

  try {
    const result = await dynamoDbLib.call("update", params);
    console.log(result);
  } catch (e) {
    console.log(
      "something went wrong when adding notification row, put error:" +
        e.message,
    );
    return false;
  }
}

/**
 *  Update number of comments in the article
 */
async function updateInArticle(data) {
  const ttlTSVal = dynamoDbLib.ttlTS(defs.TTL_AFTER_ARTICLE_FEEDBACK);

  let exprAttrValues = {
    ":zero": 0,
    ":one": 1,
    ":ttlTS": ttlTSVal,
    ":ttlDbg": dynamoDbLib.tsToDbgStr(ttlTSVal),
    ":expectedId": data.url,
  };

  let updatedExpr =
    "SET " +
    "msgCount = if_not_exists(msgCount, :zero) + :one" +
    ",ttlTS = :ttlTS, ttlDbg = :ttlDbg";

  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    // 'Key' defines the partition key and sort key of the item to be updated
    // - 'userId': Identity Pool identity id of the authenticated user
    // - 'noteId': path parameter
    Key: {
      id: data.url,
      sortKey: "articles",
    },

    ConditionExpression: "id = :expectedId", // To update the item, only if it already exists

    // 'UpdateExpression' defines the attributes to be updated
    // 'ExpressionAttributeValues' defines the value in the update expression
    // // NOTE: This will fail mysteriously if both args aren't number data types!
    UpdateExpression: updatedExpr,

    ExpressionAttributeValues: exprAttrValues,
    // 'ReturnValues' specifies if and how to return the item's attributes,
    // where ALL_NEW returns all attributes of the item after the update; you
    // can inspect 'result' below to see how it works with different settings
    //ReturnValues: "ALL_NEW"
    ReturnValues: "UPDATED_NEW",
  };

  try {
    let result = await dynamoDbLib.call("update", params);

    if (result != null) {
      if (result.Attributes != null) {
        let amount = result.Attributes.msgCount;
        if (amount != null && amount > 0) {
          return amount;
        }
      }
    }

    console.error("add_comment.updateInArticle: update didn't return msgCount");
    return -1;
  } catch (e) {
    console.error("add_comment.updateInArticle: update, Error: " + e.message);
    return -1;
  }
}

function setupComment(userId, profileData, data) {
  let ttlTS = dynamoDbLib.ttlTS(defs.TTL_ADD_COMMENT_DEFAULT_FOR_COMMENT);
  let msgId = uuid.v1();

  let newEntry = {
    id: data.url + "#msg",
    sortKey: data.parentMsgId + "#" + msgId,
    msg: data.msg,
    rssUrl: data.rssUrl,
    userId: userId,
    userPic: profileData.pic,
    userNickname: profileData.nickname,
    image: profileData.image ? profileData.image : profileData.pic,
    feedback: {
      likes: {
        users: [],
      },
      dislikes: {
        users: [],
      },
      reliable: {
        users: [],
      },
      unreliable: {
        users: [],
      },
    },
    subjectPts: [],
    ttlTS: ttlTS,
    ttlDbg: dynamoDbLib.tsToDbgStr(ttlTS),
    postedTs: dynamoDbLib.now(),
    support: [],
    deleted: false,
  };

  return newEntry;
}

const REQUIRED_PARAMS = ["msg", "url", "rssUrl", "parentMsgId"];

export async function main(event, context) {
  const data = JSON.parse(event.body);

  let userId = event.requestContext.identity.cognitoIdentityId;

  if (data == null) {
    let msg = "Json body is null";
    console.log(msg);
    return failure({ status: false, message: msg });
  } else if (userId === null) {
    let msg = "cognitoIdentityId is null";
    console.log(msg);
    return failure({ status: false, message: msg });
  } else {
    let errMsg = find_missing_params(data, REQUIRED_PARAMS);
    if (errMsg) {
      console.log("add_comment: " + errMsg);
      return failure({ status: false, message: errMsg });
    }
  }

  console.log("add_comment: got this data:");
  console.log({ userId: userId });
  console.log("?????DATTTTTTA??????", data);

  //console.log("looked up profile data for user: " + userId);
  //console.log(profileData);

  //console.log("add_comment, about to create: ");
  //console.log(newEntry);

  let profileData = await dynamoDbLib.getUserProfileData(userId);

  if (profileData === null) {
    console.error("add_comment, failed to look up user: " + userId);
    return failure({
      status: false,
      error: "Profile not found",
      errorCode: defs.ERROR_CODE_NO_PROFILE,
    });
  }

  let nrMsgs = await updateInArticle(data);

  if (nrMsgs > 0) {
    let newEntry = setupComment(userId, profileData, data);
    let saveResult = await saveComment(newEntry);
    console.log("===========zeeweesoft==============");
    console.log("SSSSSSSS", saveResult);
    console.log("XXXXXXXXX", newEntry);
    let check = await updateUserNotifications(
      data.rssUrl,
      saveResult.url,
      data.title,
      saveResult.commentId,
      data.parentUserId,
      newEntry.userNickname,
      data.notificationType, // Pass notificationType received from application side
      // data.msg.includes('#pålitligkommentar') ?
      // "comment_trustworthy" :
      // data.msg.includes('#opålitligkommentar') ?
      // "comment_not_trustworthy" :
      // "comments"
    );
    console.log("======check=======", check);

    console.log("====== data.parentUserId=======", data.parentUserId);

    // send push notification to replied user
    let recipientProfileData = await dynamoDbLib.getUserProfileData(
      data.parentUserId,
      // "eu-north-1:cba3c8cc-e8af-4394-9739-eaf35064f2a3"
    );
    console.log("======recipientProfileData=======", recipientProfileData);

    if (recipientProfileData !== null) {
      console.log(
        "sending push notification to user tokens: " +
          recipientProfileData.expoTokens,
      );
      if (
        recipientProfileData.expoTokens === null ||
        recipientProfileData.expoTokens === undefined
      ) {
        console.error("no expoTokens at: " + data.parentUserId);
      } else {
        console.log("===========sssss====welcome else==========");
        //code by sr
        //let expTokenArr = [];
        //  expTokenArr.push(recipientProfileData.expoTokens)

        //end
        // "eu-north-1:cba3c8cc-e8af-4394-9739-eaf35064f2a3",
        // "ExponentPushToken[BYVtnxPkfmFtoJ_WbOLrcJ]",
        let messageBody = "";

        if (data.parentMsgId) {
          messageBody = newEntry.userNickname + " har svarat på din kommentar";
        } else {
          messageBody =
            newEntry.userNickname + " använde din kommentar som ett belägg";
        }

        let receiptIds = await sendPushNotificationToClient(
          data.parentUserId,
          // expTokenArr,
          recipientProfileData.expoTokens,
          //     "eu-north-1:cba3c8cc-e8af-4394-9739-eaf35064f2a3",
          // ["ExponentPushToken[aYa45gOFhFU4xh2g4OvLyJ]"],
          messageBody,
        );
        console.log("receiptIds for push notifications: " + receiptIds);
      }
    } else {
      console.log(
        "failed to llok up profile for recipient of PN: " + data.parentUserId,
      );
    }

    if (saveResult) {
      const fixedComment = {
        ...newEntry,
        feedback: {
          likes: {
            amount: newEntry.feedback.likes.users.length,
            status: newEntry.feedback.likes.users.includes(userId),
          },
          dislikes: {
            amount: newEntry.feedback.dislikes.users.length,
            status: newEntry.feedback.dislikes.users.includes(userId),
          },
          reliable: {
            amount: newEntry.feedback.reliable.users.length,
            status: newEntry.feedback.reliable.users.includes(userId),
          },
          unreliable: {
            amount: newEntry.feedback.unreliable.users.length,
            status: newEntry.feedback.unreliable.users.includes(userId),
          },
        },
      };

      return success({ status: true, item: fixedComment });
    } else {
      console.error("add_comment, failed to save comment");
      return failure({
        status: false,
        error: "Failed to store comment",
        errorCode: defs.ERROR_CODE_DB_ERROR,
      });
    }
  } else {
    console.error("add_comment, failed to update article");
    return failure({
      status: false,
      error: "Failed to store comment",
      errorCode: defs.ERROR_CODE_DB_ERROR,
    });
  }
}
