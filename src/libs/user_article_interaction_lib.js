import * as dynamoDbLib from "./dynamodb-lib";
import * as defs from "./defs";

const VALID_INTERACTIONS = new Set(["scrollBy", "opened", "interest", "uninterest"]);
const VALID_VOTE_TYPES = new Set(["interest", "uninterest"]);

function userArticleSortKey(articleId) {
  return `user-article#${articleId}`;
}

async function getArticleItem(articleId) {
  const result = await dynamoDbLib.call("get", {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: { id: articleId, sortKey: "articles" },
  });
  return result?.Item ?? null;
}

async function getExistingUserArticle(userId, articleId) {
  const result = await dynamoDbLib.call("get", {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: { id: userId, sortKey: userArticleSortKey(articleId) },
  });
  return result?.Item ?? null;
}

function isOldArticle(article) {
  if (typeof article.scrollByCount === "undefined") return true;
  const nowSec = Math.floor(Date.now() / 1000);
  const ageSeconds = nowSec - article.addedTS;
  return ageSeconds >= defs.ARTICLE_LEGACY_THRESHOLD_DAYS * 3600 * 24;
}

export async function getOrCreateUserArticle({ userId, articleId, interaction }) {
  if (!VALID_INTERACTIONS.has(interaction)) {
    throw new Error(`Invalid interaction: ${interaction}`);
  }

  const article = await getArticleItem(articleId);
  if (isOldArticle(article)) {
    return { resultType: "oldArticle", message: "Old article" };
  }

  const userArticle = await getExistingUserArticle(userId, articleId);
  if (!userArticle) {
    await dynamoDbLib.call("transactWrite", {
      TransactItems: [
        {
          Put: {
            TableName: defs.WN_STR_KEY_TABLE,
            Item: {
              id: userId,
              sortKey: userArticleSortKey(articleId),
              interaction,
              userArticleTS: Math.floor(Date.now() / 1000),
            },
          },
        },
        {
          Update: {
            TableName: defs.WN_STR_KEY_TABLE,
            Key: { id: articleId, sortKey: "articles" },
            UpdateExpression: `ADD ${interaction}Count :one`,
            ExpressionAttributeValues: { ":one": 1 },
          },
        },
      ],
    });
    return { resultType: "created", message: `none to ${interaction}` };
  }

  return { resultType: "existing", existingInteraction: userArticle.interaction };
}

export async function registerScrollByEvent({ userId, articleId }) {
  const result = await getOrCreateUserArticle({ userId, articleId, interaction: "scrollBy" });

  if (result.resultType === "oldArticle") return "Old article";
  if (result.resultType === "created") return "none to scrollBy";

  const { existingInteraction } = result;
  if (existingInteraction === "scrollBy") {
    await dynamoDbLib.call("update", {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: { id: userId, sortKey: userArticleSortKey(articleId) },
      UpdateExpression: "SET userArticleTS = :ts",
      ExpressionAttributeValues: { ":ts": Math.floor(Date.now() / 1000) },
    });
    return "scrollBy timestamp updated";
  }

  return "no changes";
}

export async function registerOpenedEvent({ userId, articleId }) {
  const result = await getOrCreateUserArticle({ userId, articleId, interaction: "opened" });

  if (result.resultType === "oldArticle") return "Old article";
  if (result.resultType === "created") return "none to opened";

  const { existingInteraction } = result;

  if (existingInteraction === "scrollBy") {
    await dynamoDbLib.call("transactWrite", {
      TransactItems: [
        {
          Update: {
            TableName: defs.WN_STR_KEY_TABLE,
            Key: { id: userId, sortKey: userArticleSortKey(articleId) },
            UpdateExpression: "SET interaction = :interaction, userArticleTS = :ts",
            ExpressionAttributeValues: {
              ":interaction": "opened",
              ":ts": Math.floor(Date.now() / 1000),
            },
          },
        },
        {
          Update: {
            TableName: defs.WN_STR_KEY_TABLE,
            Key: { id: articleId, sortKey: "articles" },
            UpdateExpression: "ADD scrollByCount :neg, openedCount :one",
            ExpressionAttributeValues: { ":neg": -1, ":one": 1 },
          },
        },
      ],
    });
    return "scrollBy to opened";
  }

  if (existingInteraction === "opened") {
    await dynamoDbLib.call("update", {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: { id: userId, sortKey: userArticleSortKey(articleId) },
      UpdateExpression: "SET userArticleTS = :ts",
      ExpressionAttributeValues: { ":ts": Math.floor(Date.now() / 1000) },
    });
    return "opened timestamp updated";
  }

  // interest or uninterest — update timestamp, leave vote intact
  await dynamoDbLib.call("update", {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: { id: userId, sortKey: userArticleSortKey(articleId) },
    UpdateExpression: "SET userArticleTS = :ts",
    ExpressionAttributeValues: { ":ts": Math.floor(Date.now() / 1000) },
  });
  return "opened timestamp updated, vote unchanged";
}

export async function registerInterestVoteEvent({ userId, articleId, voteType }) {
  if (!VALID_VOTE_TYPES.has(voteType)) {
    throw new Error("voteType must be interest or uninterest");
  }

  const result = await getOrCreateUserArticle({ userId, articleId, interaction: voteType });

  if (result.resultType === "oldArticle") return "Old article";
  if (result.resultType === "created") return `none to ${voteType}`;

  const { existingInteraction } = result;
  const oppositeVote = voteType === "interest" ? "uninterest" : "interest";

  if (existingInteraction === voteType) {
    await dynamoDbLib.call("transactWrite", {
      TransactItems: [
        {
          Update: {
            TableName: defs.WN_STR_KEY_TABLE,
            Key: { id: userId, sortKey: userArticleSortKey(articleId) },
            UpdateExpression: "SET interaction = :interaction, userArticleTS = :ts",
            ExpressionAttributeValues: {
              ":interaction": "opened",
              ":ts": Math.floor(Date.now() / 1000),
            },
          },
        },
        {
          Update: {
            TableName: defs.WN_STR_KEY_TABLE,
            Key: { id: articleId, sortKey: "articles" },
            UpdateExpression: `ADD ${voteType}Count :neg`,
            ExpressionAttributeValues: { ":neg": -1 },
          },
        },
      ],
    });
    return `${voteType} vote annulled`;
  }

  if (existingInteraction === oppositeVote) {
    await dynamoDbLib.call("transactWrite", {
      TransactItems: [
        {
          Update: {
            TableName: defs.WN_STR_KEY_TABLE,
            Key: { id: userId, sortKey: userArticleSortKey(articleId) },
            UpdateExpression: "SET interaction = :interaction, userArticleTS = :ts",
            ExpressionAttributeValues: {
              ":interaction": voteType,
              ":ts": Math.floor(Date.now() / 1000),
            },
          },
        },
        {
          Update: {
            TableName: defs.WN_STR_KEY_TABLE,
            Key: { id: articleId, sortKey: "articles" },
            UpdateExpression: `ADD ${voteType}Count :one, ${oppositeVote}Count :neg`,
            ExpressionAttributeValues: { ":one": 1, ":neg": -1 },
          },
        },
      ],
    });
    return `${existingInteraction} to ${voteType}`;
  }

  // transition from scrollBy or opened to vote
  await dynamoDbLib.call("transactWrite", {
    TransactItems: [
      {
        Update: {
          TableName: defs.WN_STR_KEY_TABLE,
          Key: { id: userId, sortKey: userArticleSortKey(articleId) },
          UpdateExpression: "SET interaction = :interaction, userArticleTS = :ts",
          ExpressionAttributeValues: {
            ":interaction": voteType,
            ":ts": Math.floor(Date.now() / 1000),
          },
        },
      },
      {
        Update: {
          TableName: defs.WN_STR_KEY_TABLE,
          Key: { id: articleId, sortKey: "articles" },
          UpdateExpression: `ADD ${existingInteraction}Count :neg, ${voteType}Count :one`,
          ExpressionAttributeValues: { ":neg": -1, ":one": 1 },
        },
      },
    ],
  });
  return `${existingInteraction} to ${voteType}`;
}
