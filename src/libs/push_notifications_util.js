import { Expo } from "expo-server-sdk";
import * as dynamoDbLib from "./dynamodb-lib";
import * as defs from "./defs";

export async function sendPushNotificationToClient(
  userId,
  pushTokens,
  messageBody
) {
  // Create a new Expo SDK client
  // optionally providing an access token if you have enabled push security
  let expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  console.log("=======sssssssss=====expo======", expo);
  let messages = [];
  for (let pushToken of pushTokens) {
    // Each push token looks like ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]

    // Check that all your push tokens appear to be valid Expo push tokens
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`Push token ${pushToken} is not a valid Expo push token`);
      continue;
    }

    // Construct a message (see https://docs.expo.io/push-notifications/sending-notifications/)
    messages.push({
      to: pushToken,
      sound: "default",
      body: messageBody,
      data: { withSome: "data" },
    });
  }
  console.log("=======sssssssss=====exmessagespo======", messages);

  let expiredTokens = [];

  // The Expo push notification service accepts batches of notifications so
  // that you don't need to send 1000 requests to send 1000 notifications. We
  // recommend you batch your notifications to reduce the number of requests
  // and to compress them (notifications with similar content will get
  // compressed).
  let chunks = expo.chunkPushNotifications(messages);
  let tickets = [];
  // Send the chunks to the Expo push notification service. There are
  // different strategies you could use. A simple one is to send one chunk at a
  // time, which nicely spreads the load out over time:
  for (let chunk of chunks) {
    try {
      let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log("=======sssssssss=====rrrrrrrrrr======", ticketChunk);
      tickets.push(...ticketChunk);
      // NOTE: If a ticket contains an error code in ticket.details.error, you
      // must handle it appropriately. The error codes are listed in the Expo
      // documentation:
      // https://docs.expo.io/push-notifications/sending-notifications/#individual-errors
    } catch (error) {
      console.error(error);
    }
  }

  // Later, after the Expo push notification service has delivered the
  // notifications to Apple or Google (usually quickly, but allow the the service
  // up to 30 minutes when under load), a "receipt" for each notification is
  // created. The receipts will be available for at least a day; stale receipts
  // are deleted.
  //
  // The ID of each receipt is sent back in the response "ticket" for each
  // notification. In summary, sending a notification produces a ticket, which
  // contains a receipt ID you later use to get the receipt.
  //
  // The receipts may contain error codes to which you must respond. In
  // particular, Apple or Google may block apps that continue to send
  // notifications to devices that have blocked notifications or have uninstalled
  // your app. Expo does not control this policy and sends back the feedback from
  // Apple and Google so you can handle it appropriately.
  let receiptIds = [];
  for (let ticket of tickets) {
    // NOTE: Not all tickets have IDs; for example, tickets for notifications
    // that could not be enqueued will have error information and no receipt ID.
    if (ticket.details !== undefined && ticket.details.error !== undefined) {
      if (ticket.id) {
        receiptIds.push(ticket.id);
      }
    } else if (ticket.details?.error === "DeviceNotRegistered") {
      expiredTokens.push(ticket.message.match('\\\\\\"(.*)\\\\\\"')[1]);
    }
  }

  if (expiredTokens.length > 0) {
    await removeExpiredTokenForUser(userId, expiredTokens);
  }

  return receiptIds;
}

async function removeExpiredTokenForUser(userId, expiredTokens) {
  console.log(
    "removing expired tokens: " + expiredTokens + " from userid: " + userId
  );

  let profileData = await dynamoDbLib.getUserProfileData(userId);

  if (profileData === null) {
    console.error("f, failed to look up user: " + userId);
    return;
  }

  if (profileData.expoTokens === null || profileData.expoTokens === undefined) {
    profileData.expoTokens = [];
  }

  if (expiredTokens.some((el) => profileData.expoTokens.includes(el))) {
    profileData.expoTokens = profileData.expoTokens.filter(
      (el) => !expiredTokens.includes(el)
    );
  } else {
    console.warn("removeExpiredTokenForUser, tokens already removed");
    return;
  }

  let updateResult = await updateUserProfile(userId, profileData.expoTokens);

  if (!updateResult) {
    console.error("removeExpiredTokenForUser, failed to update user profile");
  }
}

async function updateUserProfile(userId, expoTokens) {
  console.log({ userId: userId, expoTokens: expoTokens });
  const ttlTSVal = dynamoDbLib.ttlTS(defs.TTL_SET_PROFILE_AFTER_UPDATE);
  let composedKey = "profile#" + userId;
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    // 'Key' defines the partition key and sort key of the item to be updated
    // - 'userId': Identity Pool identity id of the authenticated user
    // - 'noteId': path parameter
    Key: {
      id: composedKey,
      sortKey: defs.DB_PROFILE_SORT_KEY,
    },

    // 'UpdateExpression' defines the attributes to be updated
    // 'ExpressionAttributeValues' defines the value in the update expression
    // // NOTE: This will fail mysteriously if both args aren't number data types!
    UpdateExpression:
      "SET " + "expoTokens = :expoTokens" + ",ttlTS = :ttlTS, ttlDbg = :ttlDbg",
    ExpressionAttributeValues: {
      ":expoTokens": expoTokens,
      ":ttlTS": ttlTSVal,
      ":ttlDbg": dynamoDbLib.tsToDbgStr(ttlTSVal),
    },
    // 'ReturnValues' specifies if and how to return the item's attributes,
    // where ALL_NEW returns all attributes of the item after the update; you
    // can inspect 'result' below to see how it works with different settings
    //ReturnValues: "ALL_NEW"
    ReturnValues: "ALL_NEW",
  };

  try {
    await dynamoDbLib.call("update", params);
    return true;
  } catch (e) {
    console.error("add_expo_token: updateUserProfile, Error: " + e.message);
    return false;
  }
}
