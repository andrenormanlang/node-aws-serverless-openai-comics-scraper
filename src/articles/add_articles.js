import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as dl_xml_utils from "../libs/dl_xml_utils";
import * as defs from "../libs/defs";

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
      item.pubTS = tsForPubDate; // (same as amount attribute, put kept as a duplicate clearer name as well)
      item.sortKey = rssUrl; // Sort key for str db
      item.amount = tsForPubDate; // sort key for GSI on str db
      item.trust = {
        users: [],
      };
      item.distrust = {
        users: [],
      };
      item.likes = {
        users: [],
      };
      item.dislikes = {
        users: [],
      };
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

      //console.log("\t\tpubDateTS: " + (new Date(item.pubDateTS)) + ", addedTS: " + (new Date(item.addedTS)));
    }

    return item;
  });

  console.log(transformedRSSItems);

  dl_xml_utils.cleanAttribs(transformedRSSItems);

  //console.log("len pre: " + transformedRSSItems.length);
  //transformedRSSItems = transformedRSSItems.filter( item => { console.log("cmp: " + item.pubDate + ", " + dynamoDbLib.tsToDbgStr(item.pubTS) + " > " + dynamoDbLib.tsToDbgStr(fromTS)); return item.pubTS >= fromTS } );
  transformedRSSItems = transformedRSSItems.filter((item) => {
    return item.pubTS >= fromTS;
  });
  //console.log("len post: " + transformedRSSItems.length);

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
  let channelHeader = newsData?.channelHeader??{};

  if (newRSSItems === null || newRSSItems.length === 0) {
    console.log("updateDB: fetchNewDataFromRSS failed.");
    return null;
  }

  newRSSItems.sort(function (a, b) {
    return a.pubTS - b.pubTS;
  });
  console.log("updateDB: New RSS data:" + newRSSItems.length);
  /*newRSSItems.forEach(function(c, idx) {
    console.log(c.pubDate + " - " + c.title);
  });*/

  //
  // Sort out items that should already be in the database
  //

  //console.log("*** mostRecentItemTS: " + mostRecentItemTS);
  //console.log("Items # before filter: " + newRSSItems.length);
  let newItems = newRSSItems.filter((item) => {
    let pubTS = item.pubTS ? item.pubTS : item.sortNbr;
    return pubTS > mostRecentItemTS;
  });
  //console.log("Items # after filter: " + newItems.length);

  //
  // Write to database
  //

  let newMostRecentItemTS = mostRecentItemTS;

  if (newItems && newItems.length > 0) {
    newMostRecentItemTS = getMostRecentItemTS(newItems);

    console.log("updateDB: Items to write: " + newItems.length);

    do {
      // Write 25 items at the time, since batch write cannot write too many at once
      let itemsToWriteForLatestFeed = newItems.splice(
        0,
        newItems.length > 25 ? 25 : newItems.length
      );

      /*console.log("*** WRITE BATCH:")
      itemsToWrite.forEach(function(c) {
        console.log(c.pubDate + " - " + c.title + ": " + c.id + " + " + c.pubTS);
      });*/

      // Write the two batches, to the two tables, in parallell
      try {
        let result = await dynamoDbLib.doBatchWrite(
          defs.WN_STR_KEY_TABLE,
          itemsToWriteForLatestFeed
        );

        if (result) {
          // The result can contain unprocessed items. Perhaps this is something that we need to handle in the future
          //console.log("updateDB: Batch writes completed with results:");
          //console.log(writeResults);
        } else {
          console.log("updateDB: Batch write returned null");
        }
      } catch (e) {
        console.log(`updateDB: Batchwrite failed`);
      }
    } while (newItems.length > 0);

    /*
     */
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
      //console.log("queryMetaDataForSource, get success for: " + rssUrl);
      //console.log("RESULT:");
      //console.log(result);

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
    //console.log("queryMetaDataForSource, ts diff is: " + tsDiff);

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
    "https://www.svt.se/nyheter/rss.xml",
    "http://www.dn.se/nyheter/m/rss/",
    "https://feeds.expressen.se/nyheter/",
    "https://www.forskning.se/feed/",
    "https://www.dagensarena.se/feed/da",
    "http://www.europaportalen.se/rss/nyheter",
    "http://www.riktpunkt.nu/feed/",
    "https://kvartal.se/feed/",
    "http://www.svt.se/nyheter/varlden/rss.xml",
    "https://morgonposten.se/feed",
    "https://www.newsplitter.se/feed/",
    ];
  console.log({rssUrls});
  // wait for all sources to resolve the promise
  await Promise.all(rssUrls.map(async rssUrl => {
    try{
      console.log("checking: ",rssUrl);
      let metaDataForSource = await queryMetaDataForSource(rssUrl);
      let { mostRecentItemTS } = metaDataForSource;
        let { channelHeader, newMostRecentItemTS } = await updateDB(
          rssUrl,
          mostRecentItemTS
        );
          let res;
        if (channelHeader) {
          res = await mark_db_updated(rssUrl, newMostRecentItemTS, channelHeader);
        }
        console.log("main: UpdateDB done, result: ", res);
    }catch(e){
      console.error("could not add news to db", JSON.stringify(e, null, 2));
    }

  }));
};
