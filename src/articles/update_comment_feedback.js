import handler from "../libs/handler-lib";
import * as defs from "../libs/defs";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import { calcSubjectPts, calcSubjectCount } from "../libs/utils";
import { sendPushNotificationToClient } from "../libs/push_notifications_util";
/**
 * create a new funtion to add
 * in app notification to DB
 * @param {*} rssUrl
 * @param {*} url
 * @param {*} title
 * @param {*} commentId
 * @param {*} parentUserId
 * @param {*} username
 * @param {*} notificationType
 * @returns
 */
async function updateUserNotifications(
  rssUrl,
  url,
  title,
  commentId,
  parentUserId,
  username,
  notificationType
) {
  const notification = {
    timestamp: Math.floor(new Date().getTime() / 1000),
    read: false,
    seen: false,
    rssUrl,
    url,
    title,
    commentId,
    username,
    notificationType,
  };

  const data1 = {
    rssUrl: rssUrl,
    url: url,
    title: title,
    commentId: commentId,
    parentUserId: parentUserId,
    username: username,
    notificationType: notificationType,
  };
  console.log("TechDoodles: " + JSON.stringify(data1));
  console.log("TechDoodles_notification: " + JSON.stringify(notification));
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "notifications",
      sortKey: parentUserId,
    },
    ExpressionAttributeNames: {
      "#notification_name": notificationType,
    },
    ExpressionAttributeValues: {
      ":notification": [notification],
      ":empty_list": [],
    },
    UpdateExpression: `SET #notification_name = list_append(if_not_exists(#notification_name, :empty_list), :notification)`,
    ReturnValues: "ALL_NEW",
  };

  try {
    await dynamoDbLib.call("update", params);
    console.log("Notification Row Added");
  } catch (e) {
    console.log(
      "something went wrong when adding notification row, put error:" +
        e.message
    );
    return false;
  }
}

export const main = handler(async (event, context) => {
  const body = JSON.parse(event.body);
  console.log("TARIQRSSURL", body.rssUrl);
  console.log("=================event======================", event);

  const params = {
    userId: event.requestContext.identity.cognitoIdentityId,
    action: event.pathParameters.action,
  };

  const opposites = {
    likes: "dislikes",
    dislikes: "likes",
    reliable: "unreliable",
    unreliable: "reliable",
  };

  const writeArticleCommentFeedback = async (comment, addTo, removeFrom) => {
    if (
      addTo === "reliable" ||
      addTo === "unreliable" ||
      removeFrom === "reliable" ||
      removeFrom === "unreliable"
    )
      return;
    const articleUrl = comment.id.substr(0, comment.id.length - 4);

    const commentFeedbackQuery = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: `${articleUrl}#commentFeedback`,
        sortKey: params.userId,
      },
    };

    const articleCommentFeedback = await dynamoDbLib.call(
      "get",
      commentFeedbackQuery
    );
    let query;
    console.log(
      "----------articleCommentFeedback--------------------",
      articleCommentFeedback
    );
    const referenceComment = {
      id: `${articleUrl}#msg`,
      sortKey: comment.sortKey,
    };

    if (addTo && removeFrom) {
      const index = articleCommentFeedback.Item[removeFrom]
        .map((e) => e.sortKey)
        .indexOf(comment.sortKey);

      query = {
        TableName: defs.WN_STR_KEY_TABLE,
        Key: {
          id: `${articleUrl}#commentFeedback`,
          sortKey: params.userId,
        },
        ExpressionAttributeNames: {
          "#addTo": addTo,
          "#removeFrom": removeFrom,
        },
        ExpressionAttributeValues: {
          ":reference_comment": [referenceComment],
          ":empty_list": [],
        },
        UpdateExpression: `SET #addTo = list_append(if_not_exists(#addTo, :empty_list), :reference_comment) REMOVE #removeFrom[${index}]`,
        ReturnValues: "ALL_NEW",
      };
    } else if (addTo && !removeFrom) {
      query = {
        TableName: defs.WN_STR_KEY_TABLE,
        Key: {
          id: `${articleUrl}#commentFeedback`,
          sortKey: params.userId,
        },
        ExpressionAttributeNames: { "#addTo": addTo },
        ExpressionAttributeValues: {
          ":reference_comment": [referenceComment],
          ":empty_list": [],
        },
        UpdateExpression: `SET #addTo = list_append(if_not_exists(#addTo, :empty_list), :reference_comment)`,
        ReturnValues: "ALL_NEW",
      };
    } else if (!addTo && removeFrom) {
      const index = articleCommentFeedback.Item[removeFrom]
        .map((e) => e.sortKey)
        .indexOf(comment.sortKey);

      query = {
        TableName: defs.WN_STR_KEY_TABLE,
        Key: {
          id: `${articleUrl}#commentFeedback`,
          sortKey: params.userId,
        },
        ExpressionAttributeNames: { "#removeFrom": removeFrom },
        UpdateExpression: `REMOVE #removeFrom[${index}]`,
      };
    }

    await dynamoDbLib.call("update", query);
  };

  const commentQuery = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: body.id,
      sortKey: body.sortKey,
    },
  };

  const comment = await dynamoDbLib.call("get", commentQuery);
  console.log("----------comment--------------------", comment);
  console.log("----------commentQuery--------------------", commentQuery);

  const valuesQuery = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: "personalValues",
      sortKey: params.userId,
    },
  };

  const personalValues = await dynamoDbLib.call("get", valuesQuery);

  console.log("----------personalValues--------------------", personalValues);

  let newSubjects = [];
  // Call the function to add notification row in DB for In App
  let profileData = await dynamoDbLib.getUserProfileData(params.userId);
  const getCommentdata = comment.Item;
  const notiArticleUrl = getCommentdata.id.substr(
    0,
    getCommentdata.id.length - 4
  );
  await updateUserNotifications(
    body.rssUrl,
    notiArticleUrl,
    body.title,
    getCommentdata.sortKey.split("#")[1],
    body.parentUserId,
    profileData.nickname,
    body.notificationType // Pass notification type for comments to differenciate in application
  );
  try {
    let expression = "";
    const containsOpposite = comment.Item.feedback[
      opposites[params.action]
    ].users.includes(params.userId);
    console.log("=====containsOpposite======", containsOpposite);
    console.log("=====params.action====================", params.action);
    let msg = "";
    if (containsOpposite) {
      //this block kicks in if you switch from like to dislike and vice versa
      const index = comment.Item.feedback[
        opposites[params.action]
      ].users.indexOf(params.userId);
      if (params.action === "likes") {
        // msg = params.action+"your comment.";
        msg = "gillar din kommentar";
        newSubjects = await calcSubjectPts(
          comment.Item,
          personalValues.Item.subjects,
          true
        );
        newSubjects = await calcSubjectCount(
          newSubjects,
          personalValues.Item.subjects,
          true,
          params.userId
        );
      } else if (params.action === "dislikes") {
        // msg = params.action+"your comment.";
        msg = "ogillar din kommentar";
        newSubjects = await calcSubjectPts(
          comment.Item,
          personalValues.Item.subjects,
          false
        );
        newSubjects = await calcSubjectCount(
          newSubjects,
          personalValues.Item.subjects,
          false,
          params.userId
        );
      } else if (
        params.action === "reliable" ||
        params.action === "unreliable"
      ) {
        //msg = params.action+"your comment.";
        if (params.action === "reliable") {
          msg = "tycker din kommentar är trovärdig";
        }
        if (params.action === "unreliable") {
          msg = "ser din kommentar som tvivelaktig";
        }
        newSubjects = JSON.parse(JSON.stringify(comment.Item.subjectPts));
      }
      expression = `SET #feedback.#action.#users = list_append(if_not_exists(#feedback.#action.#users, :empty_list), :userId), #subjectPts = :subject_pts REMOVE #feedback.${
        opposites[params.action]
      }.#users[${index}]`;
    } else {
      //this block kicks if you go from nothing to dislike or nothing to like
      if (params.action === "likes") {
        // msg = params.action+" your comment.";
        msg = "gillar din kommentar";
        newSubjects = await calcSubjectPts(
          comment.Item,
          personalValues.Item.subjects,
          true
        );
        newSubjects = await calcSubjectCount(
          newSubjects,
          personalValues.Item.subjects,
          true,
          params.userId
        );
      } else if (
        params.action === "dislikes" ||
        params.action === "reliable" ||
        params.action === "unreliable"
      ) {
        //msg = params.action+" your comment.";
        if (params.action === "dislikes") {
          msg = "ogillar din kommentar";
        }
        if (params.action === "reliable") {
          msg = "tycker din kommentar är trovärdig";
        }
        if (params.action === "unreliable") {
          msg = "ser din kommentar som tvivelaktig";
        }
        newSubjects = JSON.parse(JSON.stringify(comment.Item.subjectPts));
      }
      expression = `SET #feedback.#action.#users = list_append(if_not_exists(#feedback.#action.#users, :empty_list), :userId), #subjectPts = :subject_pts`;
    }

    const query = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: body.id,
        sortKey: body.sortKey,
      },
      ExpressionAttributeNames: {
        "#feedback": "feedback",
        "#action": params.action,
        "#users": "users",
        "#subjectPts": "subjectPts",
      },
      ExpressionAttributeValues: {
        ":userId": [params.userId],
        ":userIdStr": params.userId,
        ":empty_list": [],
        ":subject_pts": newSubjects,
      },
      ConditionExpression:
        "not contains (#feedback.#action.#users, :userIdStr)",
      UpdateExpression: expression,
      ReturnValues: "ALL_NEW",
    };

    const result = await dynamoDbLib.call("update", query);
    console.log("===========================result===============", result);
    // send push notification to replied user
    let recipientProfileData = await dynamoDbLib.getUserProfileData(
      comment.Item.userId
      // "eu-central-1:cba3c8cc-e8af-4394-9739-eaf35064f2a3"
    );
    let actionProfileData = await dynamoDbLib.getUserProfileData(params.userId);
    console.log("========actionProfileData========", actionProfileData);
    console.log(
      "===========================resrecipientProfileDatault===============",
      recipientProfileData
    );
    if (recipientProfileData !== null) {
      console.log(
        "sending push notification to user tokens: " +
          recipientProfileData.expoTokens
      );
      if (
        recipientProfileData.expoTokens === null ||
        recipientProfileData.expoTokens === undefined
      ) {
        console.error("no expoTokens at:============= ");
      } else {
        //let messageBody = "Received rep ly from " + newEntry.userNickname + ": " + data.msg; nickname
        let messageBody = actionProfileData.nickname + " " + msg;

        let receiptIds = await sendPushNotificationToClient(
          comment.Item.userId,
          recipientProfileData.expoTokens,
          messageBody
        );
        console.log("ReceiptIds are: " + receiptIds);
      }
    }

    /////////
    if (containsOpposite) {
      await writeArticleCommentFeedback(
        comment.Item,
        params.action,
        opposites[params.action]
      );
    } else {
      await writeArticleCommentFeedback(comment.Item, params.action, false);
    }

    const fixedComment = {
      ...result.Attributes,
      subjectPts: result.Attributes.subjectPts.map((subject) => {
        return {
          subjectId: subject.subjectId,
          value: subject.value,
          userLikes: subject.userLikes.length,
          userDislikes: subject.userDislikes.length,
        };
      }),
      feedback: {
        likes: {
          amount: result.Attributes.feedback.likes.users.length,
          status: result.Attributes.feedback.likes.users.includes(
            params.userId
          ),
        },
        dislikes: {
          amount: result.Attributes.feedback.dislikes.users.length,
          status: result.Attributes.feedback.dislikes.users.includes(
            params.userId
          ),
        },
        reliable: {
          amount: result.Attributes.feedback.reliable.users.length,
          status: result.Attributes.feedback.reliable.users.includes(
            params.userId
          ),
        },
        unreliable: {
          amount: result.Attributes.feedback.unreliable.users.length,
          status: result.Attributes.feedback.unreliable.users.includes(
            params.userId
          ),
        },
      },
      support: {
        amount: result.Attributes.support.length,
        status: result.Attributes.support.includes(params.userId),
      },
    };

    return fixedComment;
  } catch (error) {
    console.log("error: ", error);
    if (error.message === "The conditional request failed") {
      //goes here if user is taking back their feedback by double tapping
      if (params.action === "likes") {
        newSubjects = await calcSubjectPts(
          comment.Item,
          personalValues.Item.subjects,
          false
        );
        newSubjects = await calcSubjectCount(
          newSubjects,
          personalValues.Item.subjects,
          false,
          params.userId
        );
      }
      await writeArticleCommentFeedback(comment.Item, false, params.action);
      const userIndex = comment.Item.feedback[params.action].users.indexOf(
        params.userId
      );

      const query = {
        TableName: defs.WN_STR_KEY_TABLE,
        Key: {
          id: body.id,
          sortKey: body.sortKey,
        },
        ExpressionAttributeNames: {
          "#feedback": "feedback",
          "#action": params.action,
          "#users": "users",
          "#subjectPts": "subjectPts",
        },
        ExpressionAttributeValues: {
          ":subject_pts": newSubjects,
        },
        UpdateExpression: `REMOVE #feedback.#action.#users[${userIndex}] SET #subjectPts = :subject_pts`,
        ReturnValues: "ALL_NEW",
      };

      const result = await dynamoDbLib.call("update", query);

      const fixedComment = {
        ...result.Attributes,
        subjectPts: result.Attributes.subjectPts.map((subject) => {
          return {
            subjectId: subject.subjectId,
            value: subject.value,
            userLikes: subject.userLikes.length,
            userDislikes: subject.userDislikes.length,
          };
        }),
        feedback: {
          likes: {
            amount: result.Attributes.feedback.likes.users.length,
            status: result.Attributes.feedback.likes.users.includes(
              params.userId
            ),
          },
          dislikes: {
            amount: result.Attributes.feedback.dislikes.users.length,
            status: result.Attributes.feedback.dislikes.users.includes(
              params.userId
            ),
          },
          reliable: {
            amount: result.Attributes.feedback.reliable.users.length,
            status: result.Attributes.feedback.reliable.users.includes(
              params.userId
            ),
          },
          unreliable: {
            amount: result.Attributes.feedback.unreliable.users.length,
            status: result.Attributes.feedback.unreliable.users.includes(
              params.userId
            ),
          },
        },
        support: {
          amount: result.Attributes.support.length,
          status: result.Attributes.support.includes(params.userId),
        },
      };

      return fixedComment;
    }
    return {
      message:
        "Something entierly different happened, what could have gone wrong?",
    };
  }
});
