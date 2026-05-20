import * as dynamoDbLib from "./dynamodb-lib";
import * as defs from "./defs";

// In-memory cache (survives across warm Lambda invocations)
let cachedConfig = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches GPT model config from DynamoDB. Returns null if not found.
 */
async function fetchConfigFromDB() {
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: defs.CONFIG_ID,
      sortKey: defs.CONFIG_GPT_SORT_KEY,
    },
  };

  try {
    const result = await dynamoDbLib.call("get", params);
    if (result && result.Item) {
      return result.Item;
    }
    return null;
  } catch (e) {
    console.error(
      "gpt-config: Failed to read config from DynamoDB:",
      e.message
    );
    return null;
  }
}

/**
 * Returns the current GPT config, with DynamoDB runtime overrides
 * taking precedence over env var defaults.
 *
 * Uses an in-memory cache with 5-minute TTL to minimize DynamoDB reads.
 */
export async function getGptConfig() {
  const now = Date.now();

  // Return cached config if still fresh
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedConfig;
  }

  // Fetch from DynamoDB
  const dbConfig = await fetchConfigFromDB();

  // Build config: DynamoDB values override env var defaults
  cachedConfig = {
    gptModelTitle: dbConfig?.gptModelTitle || defs.GPT_MODEL_TITLE_DEFAULT,
    gptModelShort: dbConfig?.gptModelShort || defs.GPT_MODEL_SHORT_DEFAULT,
    gptModelLong: dbConfig?.gptModelLong || defs.GPT_MODEL_LONG_DEFAULT,
    gptTokenThreshold:
      dbConfig?.gptTokenThreshold != null
        ? Number(dbConfig.gptTokenThreshold)
        : defs.GPT_TOKEN_THRESHOLD_DEFAULT,
    // Optional runtime prompt overrides.
    // These are stack-specific because each stack points to its own DynamoDB table.
    rewritePromptTitle:
      typeof dbConfig?.rewritePromptTitle === "string"
        ? dbConfig.rewritePromptTitle
        : "",
    rewritePromptDescription:
      typeof dbConfig?.rewritePromptDescription === "string"
        ? dbConfig.rewritePromptDescription
        : "",
    rewritePromptBody:
      typeof dbConfig?.rewritePromptBody === "string"
        ? dbConfig.rewritePromptBody
        : "",
  };

  cacheTimestamp = now;
  console.log(
    "gpt-config: Loaded config:",
    JSON.stringify({
      gptModelTitle: cachedConfig.gptModelTitle,
      gptModelShort: cachedConfig.gptModelShort,
      gptModelLong: cachedConfig.gptModelLong,
      gptTokenThreshold: cachedConfig.gptTokenThreshold,
      hasRewritePromptTitle: Boolean(cachedConfig.rewritePromptTitle),
      hasRewritePromptDescription: Boolean(
        cachedConfig.rewritePromptDescription
      ),
      hasRewritePromptBody: Boolean(cachedConfig.rewritePromptBody),
    })
  );
  return cachedConfig;
}

/**
 * Force-clears the in-memory cache. Useful for testing.
 */
export function clearConfigCache() {
  cachedConfig = null;
  cacheTimestamp = 0;
}
