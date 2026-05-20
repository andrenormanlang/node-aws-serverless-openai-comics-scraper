import * as defs from "./defs";
import * as dynamoDbLib from "./dynamodb-lib";

const ARTICLE_SORT_KEY = "articles";
const USER_ARTICLE_PREFIX = "user-article#";
const EIGHT_DAYS_SECONDS = defs.ARTICLE_LEGACY_THRESHOLD_DAYS * 24 * 60 * 60;

const COUNTER_BY_INTERACTION = {
  scrollBy: "scrollByCount",
  opened: "openedCount",
  interest: "interestCount",
  uninterest: "uninterestCount",
};

function nowUnixTs() {
  return Math.floor(Date.now() / 1000);
}

function buildUserArticleKey(userId, articleId) {
  return {
    id: userId,
    sortKey: `${USER_ARTICLE_PREFIX}${articleId}`,
  };
}

function assertValidInteraction(interaction) {
  if (!COUNTER_BY_INTERACTION[interaction]) {
    throw new Error(`Invalid interaction: ${interaction}`);
  }
}

function getVoteCounterName(voteType) {
  assertValidInteraction(voteType);
  return COUNTER_BY_INTERACTION[voteType];
}

async function getArticleItem(articleId) {
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: articleId,
      sortKey: ARTICLE_SORT_KEY,
    },
  };

  const result = await dynamoDbLib.call("get", params);
  return result.Item;
}

function isLegacyOrOldArticle(articleItem) {
  if (!articleItem) return true;
  if (typeof articleItem.scrollByCount !== "number") return true;
  if (typeof articleItem.addedTS !== "number") return true;

  const ageSeconds = nowUnixTs() - articleItem.addedTS;
  return ageSeconds > EIGHT_DAYS_SECONDS;
}

async function createUserArticleAndIncrementCounter({
  userId,
  articleId,
  interaction,
  articleAddedTS,
}) {
  const now = nowUnixTs();
  const userArticleKey = buildUserArticleKey(userId, articleId);
  const counterName = getVoteCounterName(interaction);

  const params = {
    TransactItems: [
      {
        Put: {
          TableName: defs.WN_STR_KEY_TABLE,
          Item: {
            ...userArticleKey,
            interaction,
            userArticleTS: now,
            ttlTS: articleAddedTS + EIGHT_DAYS_SECONDS,
          },
          ConditionExpression:
            "attribute_not_exists(id) AND attribute_not_exists(sortKey)",
        },
      },
      {
        Update: {
          TableName: defs.WN_STR_KEY_TABLE,
          Key: {
            id: articleId,
            sortKey: ARTICLE_SORT_KEY,
          },
          UpdateExpression:
            "SET #counter = if_not_exists(#counter, :zero) + :one",
          ExpressionAttributeNames: {
            "#counter": counterName,
          },
          ExpressionAttributeValues: {
            ":zero": 0,
            ":one": 1,
          },
        },
      },
    ],
  };

  await dynamoDbLib.call("transactWrite", params);
}

async function getExistingUserArticle(userId, articleId) {
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: buildUserArticleKey(userId, articleId),
  };

  const result = await dynamoDbLib.call("get", params);
  return result.Item;
}

export async function getOrCreateUserArticle({
  userId,
  articleId,
  interaction,
}) {
  assertValidInteraction(interaction);

  const articleItem = await getArticleItem(articleId);
  if (isLegacyOrOldArticle(articleItem)) {
    return {
      resultType: "oldArticle",
      message: "Old article",
    };
  }

  const existingUserArticle = await getExistingUserArticle(userId, articleId);

  if (!existingUserArticle) {
    await createUserArticleAndIncrementCounter({
      userId,
      articleId,
      interaction,
      articleAddedTS: articleItem.addedTS,
    });

    return {
      resultType: "created",
      message: `none to ${interaction}`,
    };
  }

  return {
    resultType: "existing",
    existingInteraction: existingUserArticle.interaction,
  };
}

async function updateUserArticleTimestamp(userId, articleId) {
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: buildUserArticleKey(userId, articleId),
    UpdateExpression: "SET userArticleTS = :ts",
    ExpressionAttributeValues: {
      ":ts": nowUnixTs(),
    },
  };

  await dynamoDbLib.call("update", params);
}

async function transitionInteraction({
  userId,
  articleId,
  fromCounter,
  toCounter,
  nextInteraction,
}) {
  const params = {
    TransactItems: [
      {
        Update: {
          TableName: defs.WN_STR_KEY_TABLE,
          Key: buildUserArticleKey(userId, articleId),
          UpdateExpression:
            "SET interaction = :interaction, userArticleTS = :ts",
          ExpressionAttributeValues: {
            ":interaction": nextInteraction,
            ":ts": nowUnixTs(),
          },
        },
      },
      {
        Update: {
          TableName: defs.WN_STR_KEY_TABLE,
          Key: {
            id: articleId,
            sortKey: ARTICLE_SORT_KEY,
          },
          UpdateExpression:
            "SET #fromCounter = #fromCounter - :one, #toCounter = if_not_exists(#toCounter, :zero) + :one",
          ExpressionAttributeNames: {
            "#fromCounter": fromCounter,
            "#toCounter": toCounter,
          },
          ExpressionAttributeValues: {
            ":one": 1,
            ":zero": 0,
          },
        },
      },
    ],
  };

  await dynamoDbLib.call("transactWrite", params);
}

export async function registerScrollByEvent({ userId, articleId }) {
  const genericResult = await getOrCreateUserArticle({
    userId,
    articleId,
    interaction: "scrollBy",
  });

  if (genericResult.resultType !== "existing") {
    return genericResult.message;
  }

  if (genericResult.existingInteraction === "scrollBy") {
    await updateUserArticleTimestamp(userId, articleId);
    return "scrollBy timestamp updated";
  }

  return "no changes";
}

export async function registerOpenedEvent({ userId, articleId }) {
  const genericResult = await getOrCreateUserArticle({
    userId,
    articleId,
    interaction: "opened",
  });

  if (genericResult.resultType !== "existing") {
    return genericResult.message;
  }

  if (genericResult.existingInteraction === "scrollBy") {
    await transitionInteraction({
      userId,
      articleId,
      fromCounter: "scrollByCount",
      toCounter: "openedCount",
      nextInteraction: "opened",
    });
    return "scrollBy to opened";
  }

  if (genericResult.existingInteraction === "opened") {
    await updateUserArticleTimestamp(userId, articleId);
    return "opened timestamp updated";
  }

  await updateUserArticleTimestamp(userId, articleId);
  return "opened timestamp updated, vote unchanged";
}

export async function registerInterestVoteEvent({
  userId,
  articleId,
  voteType,
}) {
  if (voteType !== "interest" && voteType !== "uninterest") {
    throw new Error("voteType must be interest or uninterest");
  }

  const genericResult = await getOrCreateUserArticle({
    userId,
    articleId,
    interaction: voteType,
  });

  if (genericResult.resultType !== "existing") {
    return genericResult.message;
  }

  const current = genericResult.existingInteraction;

  if (current === "scrollBy") {
    await transitionInteraction({
      userId,
      articleId,
      fromCounter: "scrollByCount",
      toCounter: getVoteCounterName(voteType),
      nextInteraction: voteType,
    });
    return `scrollBy to ${voteType}`;
  }

  if (current === "opened") {
    await transitionInteraction({
      userId,
      articleId,
      fromCounter: "openedCount",
      toCounter: getVoteCounterName(voteType),
      nextInteraction: voteType,
    });
    return `opened to ${voteType}`;
  }

  if (
    (current === "interest" || current === "uninterest") &&
    current !== voteType
  ) {
    await transitionInteraction({
      userId,
      articleId,
      fromCounter: getVoteCounterName(current),
      toCounter: getVoteCounterName(voteType),
      nextInteraction: voteType,
    });
    return `${current} to ${voteType}`;
  }

  if (current === voteType) {
    await transitionInteraction({
      userId,
      articleId,
      fromCounter: getVoteCounterName(voteType),
      toCounter: "openedCount",
      nextInteraction: "opened",
    });
    return `${voteType} vote annulled`;
  }

  await updateUserArticleTimestamp(userId, articleId);
  return `${voteType} timestamp updated`;
}
