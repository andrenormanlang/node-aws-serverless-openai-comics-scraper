//
// General constants for the backend
//

// Canonical RSS source list. Both the ingester (add_articles) and the
// scraper (data_scrapping_node) MUST read from here so their sortKeys
// stay in sync — they key DynamoDB items by these exact URLs.
export const RSS_SOURCES = [
  "https://www.cbr.com/feed/",
  "https://bleedingcool.com/feed/",
  "https://www.comicsbeat.com/feed/",
  "https://icv2.com/rss",
  "https://www.comicbookherald.com/feed/",
  "https://www.graphicpolicy.com/feed/",
  "https://brokenfrontier.com/feed/",
  "https://13thdimension.com/feed/",
  "https://www.denofgeek.com/comics/feed/",
  "https://comicbook.com/category/comics/feed/",
  "https://www.comicsalliance.com/feed/",
  // ── Candidates to vet with the diagnostic before trusting (feed + sample article) ──
  "https://comicsxf.com/feed/",
  "https://womenwriteaboutcomics.com/feed/",
  "https://smashpages.net/feed/",
  // ── Disabled ──
  // "https://aiptcomics.com/feed/",          // Cloudflare managed challenge on article fetch
  // "https://screenrant.com/feed/",          // Valnet; high volume, not comics-only — enable if wanted
  // "https://collider.com/feed/",            // Valnet; broad pop-culture — enable if wanted
  // "https://www.multiversitycomics.com/feed/", // ETIMEDOUT from eu-north-1
  // "https://dccomicsnews.com/feed/",           // feed inactive since March 2026
  // "https://www.gamesradar.com/comics/rss/",   // 404 — no comics-specific feed exists
  // "https://www.superherohype.com/feed/",      // 403 — blocks all RSS access
  // "https://comicbookroundup.com/feed/rss2/",  // 404 — feed gone
];

export const POPULARITY_SCORE_FROM_FEEDBACK = 5;
export const POPULARITY_SCORE_FROM_COMMENT = 15;

export const USE_LAMBDA_LIFETIME_AS_CACHE = false;

// TTL settings
export const TTL_AFTER_ARTICLE_FEEDBACK = 31;
export const TTL_RECENT_FEEDBACK = 7;
export const TTL_ADD_COMMENT_DEFAULT_FOR_COMMENT = 31;
export const TTL_ADD_FEEDBACK_ENTRY_UPDATED = TTL_AFTER_ARTICLE_FEEDBACK; // Makes sense to remember feedback, for as long as the article lives. However, the article can get more feedback... So it should probably be higher
export const TTL_RECENT_COMMENTS = 7;
export const TTL_GET_DEFAULT_FOR_LATEST_FEED_ARTICLE = 4;
export const TTL_GET_DEFAULT_FOR_META_DATA = 12;
export const TTL_SET_PROFILE_AFTER_UPDATE = 180;

// Article interaction settings
export const ARTICLE_LEGACY_THRESHOLD_DAYS = 8; // Articles older than this don't track per-user interactions

// Settings for get articles handler
export const GET_MIN_TS_BETWEEN_SYNCH = 60 * 30;
export const GET_HOURS_BACK_FOR_DB_UPDATE = 48;
export const GET_HOURS_BACK_FOR_QUERY = 6;
export const GET_NEWS_FEED_MAX_LIMIT = 100;

// Feedback categories
export const FEEDBACK_TYPE_LIKE = 1;
export const FEEDBACK_TYPE_DISLIKE = 2;
export const FEEDBACK_TYPE_TRUST = 3;
export const FEEDBACK_TYPE_DISTRUST = 4;

// Database tables and indices
export const WN_STR_KEY_TABLE = process.env.tableName
  ? process.env.tableName
  : "dev-retropop-dispatch";
export const user_pool_id = process.env.userPoolId;
export const WN_STR_KEY_AMOUNT_INDEX = "sortKey-amount-index";

// Profile
export const DB_PROFILE_SORT_KEY = "profile";

// Feedback sort keys
export const DB_FEEDBACK_SORTKEYS = {
  [FEEDBACK_TYPE_LIKE]: "like",
  [FEEDBACK_TYPE_DISLIKE]: "dislike",
  [FEEDBACK_TYPE_TRUST]: "trust",
  [FEEDBACK_TYPE_DISTRUST]: "distrust",
};

export const DB_COMMENTS_COUNT_SORTKEY = "messages"; // Rename to 'comments' perhaps?
export const DB_LATEST_COMMENTS_SORTKEY = "latest_comments";
export const DB_LATEST_FEEDBACK_SORTKEY = "latest_feedback";

// Settings for trending
export const GET_TRENDING_ITEM_MAX_LIMIT = 100;

export const TRENDING_CATEGORY_LIKE = FEEDBACK_TYPE_LIKE;
export const TRENDING_CATEGORY_DISLIKE = FEEDBACK_TYPE_DISLIKE;
export const TRENDING_CATEGORY_TRUST = FEEDBACK_TYPE_TRUST;
export const TRENDING_CATEGORY_DISTRUST = FEEDBACK_TYPE_DISTRUST;
export const TRENDING_CATEGORY_COMMENTS = 5;
export const TRENDING_CATEGORY_LATEST_COMMENTS = 6;
export const TRENDING_CATEGORY_LATEST_FEEDBACK = 7;

export const DB_TRENDING_CATEGORY_NAMES = {
  [TRENDING_CATEGORY_LIKE]: "like",
  [TRENDING_CATEGORY_DISLIKE]: "dislike",
  [TRENDING_CATEGORY_TRUST]: "trust",
  [TRENDING_CATEGORY_DISTRUST]: "distrust",
  [TRENDING_CATEGORY_COMMENTS]: DB_COMMENTS_COUNT_SORTKEY,
  [TRENDING_CATEGORY_LATEST_COMMENTS]: DB_LATEST_COMMENTS_SORTKEY,
  [TRENDING_CATEGORY_LATEST_FEEDBACK]: DB_LATEST_FEEDBACK_SORTKEY,
};

export const NOTIF_NAME_COMMENT_LIKES = "comment_likes";

// Error codes
export const ERROR_CODE_DB_ERROR = 1;
export const ERROR_CODE_NO_PROFILE = 2;

// OPEN AI KEY
export const OPEN_AI_KEY = process.env.openAiKey ? process.env.openAiKey : "";

// GPT Model Configuration — single source of truth for defaults
// Override via: CLI deploy (--gptModelTitle) or runtime DynamoDB config
export const GPT_MODEL_TITLE_DEFAULT =
  process.env.GPT_MODEL_TITLE || "gpt-4o-mini";
export const GPT_MODEL_SHORT_DEFAULT =
  process.env.GPT_MODEL_SHORT || "gpt-4o-mini";
export const GPT_MODEL_LONG_DEFAULT = process.env.GPT_MODEL_LONG || "gpt-4o";
export const GPT_TOKEN_THRESHOLD_DEFAULT =
  parseInt(process.env.GPT_TOKEN_THRESHOLD, 10) || 6000;

// DynamoDB config record keys
export const CONFIG_ID = "config";
export const CONFIG_GPT_SORT_KEY = "gpt-models";
