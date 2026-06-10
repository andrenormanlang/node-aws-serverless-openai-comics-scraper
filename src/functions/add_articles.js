import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as dl_xml_utils from "../libs/dl_xml_utils";
import * as defs from "../libs/defs";

// ─────────────────────────────────────────────
// RSS item pre-filters (mirrors is_likely_non_article_page
// from the scraping lambda, using only RSS-available fields)
// ─────────────────────────────────────────────

// Blocked URL patterns — live feeds and other non-article pages
const BLOCKED_URL_PATTERNS = [
  /\/live-blog\//i,
  /\/liveblog\//i,
  /\/live-updates\//i,
  /\/breaking-news\//i,
];

// Mirrors liveFeedBlockers in scraping lambda
const LIVE_FEED_KEYWORDS = [
  "live blog",
  "live feed",
  "live updates",
  "live coverage",
];

// Mirrors titleOnlyBlockers in scraping lambda
const TITLE_BLOCKERS = ["error", "404", "forbidden", "access denied"];

// Mirrors PAYWALL_PHRASES_TITLE in scraping lambda
const PAYWALL_TITLE_PHRASES = [
  "subscribe to read",
  "members only",
  "premium article",
];

// Mirrors accessBlockers in scraping lambda
const ACCESS_BLOCKERS = ["log in to read", "subscribe to read"];

// Mirrors normalize_for_matching in scraping lambda
function normalizeForMatching(text) {
  return text
    .toLowerCase()
    .replace(/[\u00E5\u00C5]/g, "a")
    .replace(/[\u00E4\u00C4]/g, "a")
    .replace(/[\u00F6\u00D6]/g, "o");
}

function isBlockedRSSItem(item) {
  // 1. URL pattern check
  if (BLOCKED_URL_PATTERNS.some((pattern) => pattern.test(item.id))) {
    console.log(`Skipping blocked URL pattern: ${item.id}`);
    return true;
  }

  const normalizedTitle = normalizeForMatching(item.title || "");
  const normalizedDescription = normalizeForMatching(item.description || "");

  // 2. Live feed keywords in title or description
  if (
    LIVE_FEED_KEYWORDS.some(
      (kw) => normalizedTitle.includes(kw) || normalizedDescription.includes(kw)
    )
  ) {
    console.log(`Skipping live feed keyword match: ${item.id}`);
    return true;
  }

  // 3. Hard title blockers (error pages, 404s)
  if (TITLE_BLOCKERS.some((kw) => normalizedTitle.includes(kw))) {
    console.log(`Skipping blocked title keyword: ${item.id}`);
    return true;
  }

  // 4. Paywall signals in title
  if (PAYWALL_TITLE_PHRASES.some((kw) => normalizedTitle.includes(kw))) {
    console.log(`Skipping paywall title signal: ${item.id}`);
    return true;
  }

  // 5. Access blockers in title or description
  if (
    ACCESS_BLOCKERS.some(
      (kw) => normalizedTitle.includes(kw) || normalizedDescription.includes(kw)
    )
  ) {
    console.log(`Skipping access blocker signal: ${item.id}`);
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────
// Core functions
// ─────────────────────────────────────────────

//
// fetchNewDataFromRSS
// Filter out items with pubDate older than 'fromTS'
//
async function fetchNewDataFromRSS(rssUrl, fromTS) {
  let downloadedData = await dl_xml_utils.downloadData(rssUrl);
  let channelNode = dl_xml_utils.getXmlChannelNodeFromXMLString(downloadedData);
  console.log(channelNode);
  let newsData = dl_xml_utils.extractNewsDataFromXMLChannelNode(channelNode);

  let transformedRSSItems = newsData.items;
  let channelHeader = newsData.channelHeader;

  let tsNow = dynamoDbLib.now();
  let tsNowDbg = dynamoDbLib.tsToDbgStr(tsNow);
  let adjustedCounter = -1000;

  let ttlTS = dynamoDbLib.ttlTS(defs.TTL_GET_DEFAULT_FOR_LATEST_FEED_ARTICLE);
  let ttlTSDbg = dynamoDbLib.tsToDbgStr(ttlTS);

  transformedRSSItems = transformedRSSItems.map((item) => {
    let pubDateParsed = dl_xml_utils.parseStrTimestamp(item.pubDate);

    if (pubDateParsed) {
      let formattedPubDate = dl_xml_utils.formatTSObj(pubDateParsed);
      let tsForPubDate =
        dl_xml_utils.getTimestampFromFormattedTimestamp(formattedPubDate);
      item.pubDate = formattedPubDate;
      item.pubTS = tsForPubDate; // (same as amount attribute, kept as a duplicate clearer name as well)
      item.sortKey = rssUrl; // Sort key for str db
      item.amount = tsForPubDate; // sort key for GSI on str db
      item.trust = { users: [] };
      item.distrust = { users: [] };
      item.likes = { users: [] };
      item.dislikes = { users: [] };
      item.scrollByCount = 0;
      item.openedCount = 0;
      item.interestCount = 0;
      item.uninterestCount = 0;
      item.msgCount = 0;
      item.addedTS = tsNow;
      item.addedTSDbg = tsNowDbg;
      item.ttlTS = ttlTS;
      item.ttlDbg = ttlTSDbg;
      item.id = item.link; // id and link are the same, since id might change, and since link is a clearer name
      item.rssUrl = rssUrl;
      item.subjects = [];
      item.support = [];

      if (item.pubTS > tsNow) {
        // There was a bug with a pubTS that for some reason was in future time. This broke the fetch flow.
        // This is an attempt to prevent that, if it happens in the future.
        // -1000 is used as an offset to prevent the pubTS to be bigger than tsNow.
        // It's also incremented for each adjustment, since pubTS cannot be the same for two articles.
        let adjustedPubDate = tsNow + adjustedCounter++;
        console.log(
          `*** Had to adjust date for pubTS from ${item.pubTS} to ${adjustedPubDate}`
        );
        item.pubTS = adjustedPubDate;
      }
    }

    return item;
  });

  console.log(transformedRSSItems);

  dl_xml_utils.cleanAttribs(transformedRSSItems);

  transformedRSSItems = transformedRSSItems.filter((item) => {
    return item.pubTS >= fromTS;
  });

  return { items: transformedRSSItems, channelHeader };
}

function getMostRecentItemTS(newItems) {
  let maxTs = -1;

  newItems.forEach((item) => {
    let pubTs = item.pubTS ? item.pubTS : item.sortNbr; // Some DB items still have the obsolete sortNbr attribute, remove this later
    if (pubTs > maxTs) {
      maxTs = item.pubTS;
    }
  });

  return maxTs;
}

//
// updateDB
//
async function updateDB(rssUrl, mostRecentItemTS) {
  let tsNow = dynamoDbLib.now();
  let xHoursAgoTS = tsNow - defs.GET_HOURS_BACK_FOR_DB_UPDATE * 3600;

  //
  // Grab data from RSS
  //
  let newsData = await fetchNewDataFromRSS(rssUrl, xHoursAgoTS);
  console.log(newsData);
  let newRSSItems = newsData.items;
  let channelHeader = newsData?.channelHeader ?? {};

  if (newRSSItems === null || newRSSItems.length === 0) {
    console.log("updateDB: fetchNewDataFromRSS failed.");
    return null;
  }

  newRSSItems.sort(function (a, b) {
    return a.pubTS - b.pubTS;
  });
  console.log("updateDB: New RSS data:" + newRSSItems.length);

  //
  // Sort out items that should already be in the database
  //
  let newItems = newRSSItems.filter((item) => {
    let pubTS = item.pubTS ? item.pubTS : item.sortNbr;
    return pubTS > mostRecentItemTS;
  });

  //
  // Write to database
  //
  let newMostRecentItemTS = mostRecentItemTS;

  if (newItems && newItems.length > 0) {
    // Filter out non-article items before writing to DB
    const filteredItems = newItems.filter((item) => !isBlockedRSSItem(item));

    if (filteredItems.length === 0) {
      console.log("updateDB: No new items after RSS filtering");
      return { channelHeader, newMostRecentItemTS };
    }

    newMostRecentItemTS = getMostRecentItemTS(filteredItems);
    console.log(
      "updateDB: Items to write after filtering: " + filteredItems.length
    );

    let itemsToWrite = [...filteredItems]; // copy so splice doesn't mutate the original
    do {
      // Write 25 items at the time, since batch write cannot write too many at once
      let itemsToWriteForLatestFeed = itemsToWrite.splice(
        0,
        itemsToWrite.length > 25 ? 25 : itemsToWrite.length
      );

      try {
        let result = await dynamoDbLib.doBatchWrite(
          defs.WN_STR_KEY_TABLE,
          itemsToWriteForLatestFeed
        );

        if (result) {
          // The result can contain unprocessed items. Perhaps this is something that we need to handle in the future
        } else {
          console.log("updateDB: Batch write returned null");
        }
      } catch (e) {
        console.log(`updateDB: Batchwrite failed`);
      }
    } while (itemsToWrite.length > 0);
  } else {
    console.log("updateDB: No new items to add");
  }

  return { channelHeader, newMostRecentItemTS };
}

//
// Mark the last synch time stamp for the provided RSS source
//
async function mark_db_updated(rssUrl, mostRecentItemTS, channelHeader) {
  let ttlTS = dynamoDbLib.ttlTS(defs.TTL_GET_DEFAULT_FOR_META_DATA);

  let { title, description, lastBuildDate, imageUrl } = channelHeader;

  var params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Item: {
      id: rssUrl,
      sortKey: "synchMeta",
      tsLastSynched: dynamoDbLib.now(),
      ttlTS,
      ttlDbg: dynamoDbLib.tsToDbgStr(ttlTS),
      title,
      description,
      lastBuildDate,
      imageUrl,
      mostRecentItemTS,
    },
    ReturnValues: "NONE",
  };

  try {
    const result = await dynamoDbLib.call("put", params);
    if (result) {
      console.log("mark_db_updated, success for: " + rssUrl);
      return true;
    } else {
      console.log("mark_db_updated, put return nil");
      return false;
    }
  } catch (e) {
    console.log("mark_db_updated, put error:" + e.message);
    return false;
  }
}

//
// Has enough time past since the last time that we updated the DB?
//
async function queryMetaDataForSource(rssUrl) {
  var params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: rssUrl,
      sortKey: "synchMeta",
    },
    ProjectionExpression:
      "tsLastSynched,title,description,imageUrl,mostRecentItemTS",
  };

  let tsLastSynched = -1;
  let channelHeader = {};
  let mostRecentItemTS = -1;

  try {
    const result = await dynamoDbLib.call("get", params);
    if (result) {
      if (result.Item) {
        let item = result.Item;

        tsLastSynched = item.hasOwnProperty("tsLastSynched")
          ? item.tsLastSynched
          : -1;

        if (item.mostRecentItemTS) {
          mostRecentItemTS = item.mostRecentItemTS;
        }

        channelHeader.title = item.title;
        channelHeader.description = item.description;
        channelHeader.lastBuildDate = item.lastBuildDate;
        channelHeader.imageUrl = item.imageUrl;
      }
    } else {
      console.log("queryMetaDataForSource, get returned nil for: " + rssUrl);
      return { shouldUpdate: true, channelHeader };
    }
  } catch (e) {
    console.log(
      `queryMetaDataForSource, get error for RSS ${rssUrl}: ${e.message}`
    );
    return { shouldUpdate: true, channelHeader };
  }

  if (tsLastSynched > -1) {
    let tsDiff = dynamoDbLib.now() - tsLastSynched;

    if (tsDiff > defs.GET_MIN_TS_BETWEEN_SYNCH) {
      console.log(
        `queryMetaDataForSource: For ${rssUrl}, time passed since last synch ts: ${tsDiff} is more than ${defs.GET_MIN_TS_BETWEEN_SYNCH}, return true`
      );
      return { shouldUpdate: true, mostRecentItemTS, channelHeader };
    } else {
      console.log(
        `queryMetaDataForSource: For ${rssUrl}, time passed since last synch ts: ${tsDiff} is less than ${defs.GET_MIN_TS_BETWEEN_SYNCH}, return false`
      );
      return { shouldUpdate: false, mostRecentItemTS, channelHeader };
    }
  } else {
    console.log(
      `queryMetaDataForSource: Failed to retrieve time diff since last sync for ${rssUrl}, return true`
    );
    return { shouldUpdate: true, mostRecentItemTS, channelHeader };
  }
}

export async function main() {
  console.log("adding articles");
  let rssUrls = [
    "https://www.cbr.com/feed/",
    "https://bleedingcool.com/feed/",
    "https://www.comicsbeat.com/feed/",
    "https://icv2.com/rss",
    "https://aiptcomics.com/feed/",
    "https://www.comicbookherald.com/feed/",
    "https://www.graphicpolicy.com/feed/",
    "https://brokenfrontier.com/feed/",
    "https://13thdimension.com/feed/",
    "https://www.denofgeek.com/comics/feed/",
    "https://comicbook.com/category/comics/feed/",
    "https://www.comicsalliance.com/feed/",
    // "https://www.multiversitycomics.com/feed/", // ETIMEDOUT from eu-north-1
    // "https://dccomicsnews.com/feed/",           // feed inactive since March 2026
    // "https://www.gamesradar.com/comics/rss/",   // 404 — no comics-specific feed exists
    // "https://www.superherohype.com/feed/",      // 403 — blocks all RSS access
    // "https://comicbookroundup.com/feed/rss2/",  // 404 — feed gone
  ];
  console.log({ rssUrls });

  await Promise.all(
    rssUrls.map(async (rssUrl) => {
      try {
        console.log("checking: ", rssUrl);
        let metaDataForSource = await queryMetaDataForSource(rssUrl);
        let { mostRecentItemTS } = metaDataForSource;
        const updateResult = await updateDB(rssUrl, mostRecentItemTS);
        if (!updateResult) {
          console.log(`updateDB returned null for ${rssUrl}, skipping`);
          return;
        }
        let { channelHeader, newMostRecentItemTS } = updateResult;
        let res;
        if (channelHeader) {
          res = await mark_db_updated(
            rssUrl,
            newMostRecentItemTS,
            channelHeader
          );
        }
        console.log("main: UpdateDB done, result: ", res);
      } catch (e) {
        console.error("could not add news to db", rssUrl, e?.message ?? e);
      }
    })
  );
}
