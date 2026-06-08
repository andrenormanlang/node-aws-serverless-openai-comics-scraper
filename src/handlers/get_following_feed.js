import * as defs from "../libs/defs";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import { success, failure } from "../libs/response-lib";

const COMMENTS_BY_USER_INDEX = "comments-user-timestamp-index";
const MAX_COMMENTS_PER_FOLLOWEE = 5;
const MAX_ARTICLES = 100;
const FEED_WINDOW_DAYS = 7;
const SECONDS_PER_DAY = 86400;

function buildArticlePayload(art, userId) {
  return {
    ...art,
    trust: {
      amount: art.trust ? art.trust.users.length : 0,
      status: art.trust ? art.trust.users.includes(userId) : false,
    },
    distrust: {
      amount: art.distrust ? art.distrust.users.length : 0,
      status: art.distrust ? art.distrust.users.includes(userId) : false,
    },
    likes: {
      amount:
        typeof art.interestCount === "number"
          ? art.interestCount
          : art.likes && art.likes.users
          ? art.likes.users.length
          : 0,
      status: art.likes && art.likes.users ? art.likes.users.includes(userId) : false,
    },
    dislikes: {
      amount:
        typeof art.uninterestCount === "number"
          ? art.uninterestCount
          : art.dislikes && art.dislikes.users
          ? art.dislikes.users.length
          : 0,
      status: art.dislikes && art.dislikes.users ? art.dislikes.users.includes(userId) : false,
    },
    support: {
      amount: art.support ? art.support.length : 0,
      status: art.support ? art.support.includes(userId) : false,
    },
    subjects: art.subjects
      ? art.subjects.map((subject) => ({
          id: subject.id,
          users: subject.users.length,
          status: subject.users.includes(userId),
        }))
      : [],
  };
}

async function queryCommentsByFollowee(followeeId, oldestTs) {
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    IndexName: COMMENTS_BY_USER_INDEX,
    KeyConditionExpression: "userId = :uid AND postedTs >= :oldest",
    ExpressionAttributeValues: {
      ":uid": followeeId,
      ":oldest": oldestTs,
    },
    ScanIndexForward: false,
    Limit: MAX_COMMENTS_PER_FOLLOWEE,
  };

  try {
    const result = await dynamoDbLib.call("query", params);
    return result.Items || [];
  } catch (e) {
    console.error(`get_following_feed.queryCommentsByFollowee: userId=${followeeId}, error=${e.message}`);
    return [];
  }
}

export async function main(event, context) {
  const userId = event.requestContext.identity.cognitoIdentityId;

  if (!userId) {
    return failure({ status: false, message: "Unauthorized" });
  }

  const queryParams = event.queryStringParameters || {};
  const nextToken = queryParams.nextToken
    ? JSON.parse(Buffer.from(queryParams.nextToken, "base64").toString("utf8"))
    : null;
  const beforeTs = nextToken ? nextToken.beforeTs : null;

  // 1. Fetch all followees
  let followeesResult;
  try {
    followeesResult = await dynamoDbLib.call("query", {
      TableName: defs.WN_STR_KEY_TABLE,
      KeyConditionExpression: "id = :id",
      ExpressionAttributeValues: {
        ":id": `profile#${userId}#following`,
      },
    });
  } catch (e) {
    console.error("get_following_feed: failed to fetch followees: " + e.message);
    return failure({ status: false, message: "Failed to fetch followees" });
  }

  const followees = followeesResult.Items || [];

  if (followees.length === 0) {
    return success({
      articles: [],
      metadata: { emptyReason: "NO_FOLLOWEE_ACTIVITY" },
    });
  }

  // 2. Query the GSI for each followee in parallel
  const oldestTs = dynamoDbLib.now() - FEED_WINDOW_DAYS * SECONDS_PER_DAY;
  const followeeIds = followees.map((f) => f.sortKey);

  const commentArrays = await Promise.all(
    followeeIds.map((fid) => queryCommentsByFollowee(fid, oldestTs))
  );

  const allComments = commentArrays.flat();

  if (allComments.length === 0) {
    return success({
      articles: [],
      metadata: { emptyReason: "NO_FOLLOWEE_ACTIVITY" },
    });
  }

  // 3. Group comments by article id
  const commentsByArticle = new Map();
  for (const comment of allComments) {
    const articleId = comment.id.replace(/#msg$/, "");
    if (!commentsByArticle.has(articleId)) {
      commentsByArticle.set(articleId, { comments: [], rssUrl: comment.rssUrl });
    }
    commentsByArticle.get(articleId).comments.push(comment);
  }

  // 4. Sort articles by their most recent comment postedTs, apply cursor filter
  let articleEntries = Array.from(commentsByArticle.entries()).map(([articleId, { comments, rssUrl }]) => {
    const sortedComments = comments.sort((a, b) => b.postedTs - a.postedTs);
    return { articleId, rssUrl, comments: sortedComments, latestTs: sortedComments[0].postedTs };
  });

  articleEntries.sort((a, b) => b.latestTs - a.latestTs);

  if (beforeTs !== null) {
    articleEntries = articleEntries.filter((e) => e.latestTs < beforeTs);
  }

  const page = articleEntries.slice(0, MAX_ARTICLES);

  // 5. Batch-fetch article items. sortKey = rssUrl (the feed the article belongs to).
  const articleKeys = page.map(({ articleId, rssUrl }) => ({
    id: articleId,
    sortKey: rssUrl,
  }));

  let fetchedArticles = [];
  try {
    const batchResult = await dynamoDbLib.doBatchRead(defs.WN_STR_KEY_TABLE, articleKeys);
    if (batchResult && batchResult.Responses) {
      fetchedArticles = batchResult.Responses[defs.WN_STR_KEY_TABLE] || [];
    }
  } catch (e) {
    console.error("get_following_feed: batch read failed: " + e.message);
    return failure({ status: false, message: "Failed to fetch articles" });
  }

  // Index fetched articles by id for O(1) lookup
  const articleMap = new Map(fetchedArticles.map((a) => [a.id, a]));

  // 6. Build response articles
  const articles = [];
  for (const { articleId, comments } of page) {
    const articleItem = articleMap.get(articleId);
    if (!articleItem) continue;

    const commentMetadata = comments.map((c) => ({
      sortKey: c.sortKey,
      postedTs: c.postedTs,
      userId: c.userId,
      userNickname: c.userNickname,
    }));

    articles.push({
      ...buildArticlePayload(articleItem, userId),
      commentMetadata,
    });
  }

  if (articles.length === 0) {
    return success({
      articles: [],
      metadata: { emptyReason: "NO_FOLLOWEE_ACTIVITY" },
    });
  }

  // 7. Build pagination cursor
  const hasMore = articleEntries.length > MAX_ARTICLES;
  const lastArticle = page[page.length - 1];
  const responseNextToken = hasMore
    ? Buffer.from(JSON.stringify({ beforeTs: lastArticle.latestTs })).toString("base64")
    : undefined;

  const metadata = {};
  if (responseNextToken) {
    metadata.nextToken = responseNextToken;
  }

  return success({ articles, metadata });
}
