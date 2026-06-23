import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  BatchWriteCommand,
  BatchGetCommand,
} from "@aws-sdk/lib-dynamodb";
import * as defs from "./defs";

const ddbClient = new DynamoDBClient({});
// Create a DynamoDBDocumentClient that removes undefined values when marshalling.
// This prevents errors when objects contain undefined fields (common in optional fields).
const marshallOptions = { removeUndefinedValues: true };
const translateConfig = { marshallOptions };
const docClient = DynamoDBDocumentClient.from(ddbClient, translateConfig);

const commands = {
  get: GetCommand,
  put: PutCommand,
  delete: DeleteCommand,
  query: QueryCommand,
  scan: ScanCommand,
  transactWrite: TransactWriteCommand,
  update: UpdateCommand,
  batchWrite: BatchWriteCommand,
  batchGet: BatchGetCommand,
};

export function call(action, params) {
  const Command = commands[action];
  return docClient.send(new Command(params));
}

export async function getUserProfileData(userId) {
  let composedKey = "profile#" + userId;

  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: composedKey,
      sortKey: defs.DB_PROFILE_SORT_KEY,
    },
  };

  try {
    const result = await call("get", params);
    if (result && result.Item) {
      return result.Item;
    } else {
      console.error("dynamodb-lib.getUserProfileData, empty item returned.");
      return null;
    }
  } catch (e) {
    console.error("dynamodb-lib.getUserProfileData, Error: " + e.message);
    return null;
  }
}

export async function checkFollower(userId, followingUserId) {
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: `profile#${userId}#following`,
      sortKey: followingUserId,
    },
  };

  try {
    const result = await call("get", params);

    if (result && result.Item) {
      return true;
    } else {
      return null;
    }
  } catch (e) {
    return null;
  }
}

const SEC_PER_DAY = 3600 * 24;

export function ttlTS(daysFromNow) {
  return Math.round(Date.now() / 1000) + daysFromNow * SEC_PER_DAY;
}

export function tsToDbgStr(ts) {
  let tmp = new Date(ts * 1000);
  return tmp.toDateString() + ", " + tmp.toTimeString();
}

export function now() {
  return Math.round(Date.now() / 1000);
}

//
// doBatchWrite
//
export async function doBatchWrite(tableName, items) {
  let putReqItems = items.map((an_item) => {
    return {
      PutRequest: {
        Item: an_item,
      },
    };
  });

  const requestItems = {};
  requestItems[tableName] = putReqItems;

  const params = {
    RequestItems: requestItems,
  };

  try {
    const result = await call("batchWrite", params);

    if (result) {
      return result;
    } else {
      console.log("batchWrite seems to have returned empty result.");
      return null;
    }
  } catch (e) {
    console.log("batchWrite error:");
    console.log(e.message);
    return null;
  }
}

export async function doBatchRead(tableName, inputKeys) {
  console.log(inputKeys.length);

  const params = {
    RequestItems: {
      [tableName]: {
        Keys: inputKeys,
      },
    },
  };
  console.log("Prepare to write:");
  console.log(params);

  try {
    const result = await call("batchGet", params);
    if (result) {
      return result;
    } else {
      console.log("doBatchRead: batchGet seems to have returned empty result.");
      return null;
    }
  } catch (e) {
    console.error("doBatchRead error: " + e.message);
    return null;
  }
}

async function queryIndexForCategory(categoryName, maxResultLimit) {
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    IndexName: defs.WN_STR_KEY_AMOUNT_INDEX,
    KeyConditionExpression: "sortKey = :sortKey",
    ExpressionAttributeValues: {
      ":sortKey": categoryName,
    },
    Limit: maxResultLimit,
    ScanIndexForward: false,
  };

  try {
    const result = await call("query", params);

    if (result && result.Items) {
      return result.Items;
    } else {
      console.log("doQuery: Query returned empty result.");
      return [];
    }
  } catch (e) {
    if (e.code === "ResourceNotFoundException") {
      console.log("doQuery: error: ResourceNotFoundException");
      return null;
    } else {
      console.log("doQuery: error: ");
      console.log(e.message);
      return null;
    }
  }
}

export async function queryArticles(articleKeys) {
  let batchReadResult = await doBatchRead(defs.WN_STR_KEY_TABLE, articleKeys);

  console.log("batchReadResult: ", batchReadResult);
  console.log(batchReadResult.Responses[defs.WN_STR_KEY_TABLE]);

  if (batchReadResult && batchReadResult.Responses) {
    let articleItems = batchReadResult.Responses[defs.WN_STR_KEY_TABLE];

    if (articleItems) {
      return articleItems;
    }
  }
  return null;
}

export async function doQueryNewsFeed(rssUrl, oldestTS) {
  let indexItems = await queryIndexForCategory(
    rssUrl,
    defs.GET_NEWS_FEED_MAX_LIMIT,
  );

  console.log("indexItems: ", indexItems);

  if (indexItems && indexItems.length > 0) {
    let articleKeys = indexItems.map((indexItem) => {
      let { id, sortKey } = indexItem;
      if (id && sortKey) {
        return { id, sortKey };
      } else {
        return null;
      }
    });

    console.log("yaboy: ", articleKeys);

    articleKeys = articleKeys.filter((articleKey) => articleKey != null);

    if (!articleKeys || articleKeys.length < 1) {
      console.error("dynamodb-lib.doQueryNewsFeed: Got no items from index");
      return null;
    }

    let articles = await queryArticles(articleKeys);

    return articles;
  }

  return null;
}

// Fetch the 100 latest added article items from DynamoDB.
export async function fetchLatestArticles() {
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    IndexName: defs.WN_STR_KEY_AMOUNT_INDEX,
    KeyConditionExpression: "sortKey = :sortKey",
    ExpressionAttributeValues: {
      ":sortKey": "article",
    },
    Limit: 100,
    ScanIndexForward: false,
  };
  try {
    const result = await call("query", params);
    if (result && result.Items) {
      return result.Items;
    } else {
      console.error("Fetch latest articles: Query returned empty result.");
      return [];
    }
  } catch (e) {
    console.error("Fetch latest articles: Error - " + e.message);
    return [];
  }
}

// Check RSS feeds for new articles.
export async function checkAndAddNewArticles(rssFeeds) {
  const newArticles = [];
  for (const rssFeed of rssFeeds) {
    const articles = await doQueryNewsFeed(rssFeed.url, rssFeed.oldestTS);
    if (articles && articles.length > 0) {
      for (const article of articles) {
        const exists = await checkIfArticleExists(article.id);
        if (!exists) {
          newArticles.push(article);
        }
      }
    }
  }

  if (newArticles.length > 0) {
    await doBatchWrite(defs.WN_STR_KEY_TABLE, newArticles);
  }
  return newArticles;
}

async function checkIfArticleExists(articleId) {
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: articleId,
      sortKey: "article",
    },
  };
  try {
    const result = await call("get", params);
    return !!result.Item;
  } catch (e) {
    console.error("Check if article exists: Error - " + e.message);
    return false;
  }
}
