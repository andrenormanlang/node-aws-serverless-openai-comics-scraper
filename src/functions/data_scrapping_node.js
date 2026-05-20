import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import fetch from "node-fetch";
import { JSDOM, VirtualConsole } from "jsdom";
import slugify from "slugify";
import {
  rephrase_data_from_openai,
  classify_subject_from_openai,
} from "../libs/rephrase-lib";

const silentVirtualConsole = new VirtualConsole();
silentVirtualConsole.sendTo(console, { omitJSDOMErrors: true });

// Canonicalize URLs to avoid duplicate processing caused by tracking params.
const TRACKING_QUERY_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
];

// Prefer host-specific selectors first, then fallback to generic content blocks.
const DEFAULT_SELECTORS = [
  "article",
  "main article",
  "div.nyh_article-body",
  "div.article__body-text",
  "div.entry-content",
  "section.summary",
  "div.article__body",
  "div.sesamy-preview",
  ".TextArticle__main___d4J+R",
  ".direkt-post__content",
  ".article-content",
  ".StructuredArticleBody__root___BgK+W",
  'div[itemprop="articleBody"]',
  "div.article__lead",
];

const SELECTORS_BY_HOST = {
  "dn.se": [
    "article",
    "div[data-testid='article-body']",
    "div.article__body",
    "main article",
  ],
  "svt.se": ["div.nyh_article-body", "article", "main article"],
  "expressen.se": ["article", "div.article__body-text", "main article"],
};

// Deterministic cleanup of obvious scraping noise before AI rewriting.
const JUNK_LINE_PATTERNS = [
  /^foto\s*:/i,
  /^foto\s+/i,
  /^fotograf\s*:/i,
  /^bild\s*:/i,
  /^(bildtext|bildtexten)\s*:/i,
  /^(fotokredit|bildkalla|bildkrediter)\s*:/i,
  /^(las mer|klicka har|prenumerera|tipsa oss|las hela)\b/i,
  /^oppna bild i helskarm$/i,
  /^(folj oss|dela artikeln|share|facebook|instagram|twitter|x\.com)\b/i,
  /^(meny|navigering|annonser|annons)\b/i,
];

const NOISE_SUBSTRINGS = [
  "oppna bild i helskarm",
  "oppna i helskarm",
  "hoppa till innehall",
  "till startsidan",
  "relaterade artiklar",
  "kommentera artikeln",
  "visa mer",
  "visa fler",
];

const URL_IN_LINE_REGEX = /(https?:\/\/|www\.)\S+/i;
const BARE_DOMAIN_REGEX =
  /\b[a-z0-9-]+\.(se|com|net|org|nu|io|co)\b(?:\/\S*)?/i;
// Phrases reliable only in the page <title> (too generic in body).
const PAYWALL_PHRASES_TITLE = [
  "las gratis i",
  "las upp alla artiklar",
  "prenumerera for att lasa",
];
// Phrases specific enough to be a paywall signal in the body.
const PAYWALL_PHRASES_BODY = [
  "det har ingar i dn enkel",
  "godkann kop",
  "prenumerationsvillkoren",
];
const SLUG_MAX_LENGTH = 100;
const ITEM_PROCESS_CONCURRENCY = 4;
const MIN_ARTICLE_TEXT_LENGTH = 250;

function canonicalize_article_url(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";

    for (const param of TRACKING_QUERY_PARAMS) {
      parsed.searchParams.delete(param);
    }

    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function dedupe_items_by_canonical_url(items) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const canonicalId = canonicalize_article_url(item.id);
    if (seen.has(canonicalId)) {
      continue;
    }

    seen.add(canonicalId);
    output.push({ ...item });
  }

  return output;
}

function normalize_for_matching(text) {
  return text
    .toLowerCase()
    .replace(/[\u00E5\u00C5]/g, "a")
    .replace(/[\u00E4\u00C4]/g, "a")
    .replace(/[\u00F6\u00D6]/g, "o");
}

function is_likely_link_line(rawLine, normalizedLine) {
  if (/^(lank|lankar)\s*:/.test(normalizedLine)) {
    return true;
  }

  if (URL_IN_LINE_REGEX.test(rawLine)) {
    return true;
  }

  if (
    BARE_DOMAIN_REGEX.test(normalizedLine) &&
    normalizedLine.split(/\s+/).length <= 12
  ) {
    return true;
  }

  return false;
}

function should_drop_line(line) {
  const normalized = normalize_for_matching(line).trim();

  if (JUNK_LINE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  if (is_likely_link_line(line, normalized)) {
    return true;
  }

  return NOISE_SUBSTRINGS.some((phrase) => normalized.includes(phrase));
}

function get_selectors_for_url(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return [...(SELECTORS_BY_HOST[host] || []), ...DEFAULT_SELECTORS];
  } catch {
    return DEFAULT_SELECTORS;
  }
}

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "ARTICLE",
  "SECTION",
  "HEADER",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "TR",
  "BLOCKQUOTE",
  "BR",
]);

function extract_text_with_newlines(node) {
  let text = "";
  function walk(el) {
    if (el.nodeType === 3) {
      text += el.textContent;
    } else if (el.nodeType === 1) {
      if (BLOCK_TAGS.has(el.tagName)) text += "\n";
      for (const child of el.childNodes) walk(child);
      if (BLOCK_TAGS.has(el.tagName)) text += "\n";
    }
  }
  walk(node);
  return text;
}

function extract_article_body(document, url) {
  for (const selector of get_selectors_for_url(url)) {
    const node = document.querySelector(selector);
    if (!node) {
      continue;
    }

    const candidate = extract_text_with_newlines(node).trim();
    if (candidate.length > 200) {
      return candidate;
    }
  }

  return "";
}

function get_og_type(document) {
  const ogType =
    document
      .querySelector('meta[property="og:type"]')
      ?.getAttribute("content") || "";
  return normalize_for_matching(ogType).trim();
}

function has_login_form(document) {
  if (document.querySelector('input[type="password"]')) {
    return true;
  }

  const forms = Array.from(document.querySelectorAll("form"));
  return forms.some((form) => {
    const action = normalize_for_matching(form.getAttribute("action") || "");
    return (
      action.includes("login") ||
      action.includes("logga") ||
      action.includes("signin")
    );
  });
}

function has_noindex_meta(document) {
  const robots =
    document.querySelector('meta[name="robots"]')?.getAttribute("content") ||
    "";
  const normalizedRobots = normalize_for_matching(robots);
  return normalizedRobots.includes("noindex");
}

function has_inaccessible_ld_json(document) {
  const ldJsonScripts = Array.from(
    document.querySelectorAll('script[type="application/ld+json"]')
  );

  const inspectEntry = (entry) => {
    if (!entry) {
      return false;
    }

    if (Array.isArray(entry)) {
      return entry.some(inspectEntry);
    }

    if (typeof entry !== "object") {
      return false;
    }

    if (Object.prototype.hasOwnProperty.call(entry, "isAccessibleForFree")) {
      const value = String(entry.isAccessibleForFree).toLowerCase().trim();
      if (value === "false") {
        return true;
      }
    }

    if (entry["@graph"] && inspectEntry(entry["@graph"])) {
      return true;
    }

    return false;
  };

  for (const script of ldJsonScripts) {
    const rawJson = (script.textContent || "").trim();
    if (!rawJson) {
      continue;
    }

    try {
      const parsed = JSON.parse(rawJson);
      if (inspectEntry(parsed)) {
        return true;
      }
    } catch {
      // Invalid ld+json blobs should not fail scraping.
    }
  }

  return false;
}

function is_likely_non_article_page(document, text, sourceUrl = "") {
  const title = normalize_for_matching(
    (document.querySelector("title")?.textContent || "").trim()
  );

  // NEW: Grab the meta description to catch "direktflöde" (live feed) signals
  const description = normalize_for_matching(
    (document.querySelector('meta[name="description"]')?.content || "").trim()
  );

  const body = normalize_for_matching(text);

  const accessBlockers = ["logga in", "prenumerera for att lasa"];
  const titleOnlyBlockers = ["error", "404", "forbidden", "access denied"];

  // NEW: Keywords specific to live feeds, news-in-brief, or index aggregates
  const liveFeedBlockers = [
    "senaste nytt i korthet",
    "direktflöde",
  ];

  const hasAccessSignal = accessBlockers.some(
    (x) => title.includes(x) || body.includes(x)
  );

  // NEW: Check if the title or description contains live feed keywords
  const hasLiveFeedSignal = liveFeedBlockers.some(
    (x) => title.includes(x) || description.includes(x)
  );

  const hasStructuredPaywallSignal = has_inaccessible_ld_json(document);
  const ogType = get_og_type(document);
  const hasLoginForm = has_login_form(document);
  const hasNoIndex = has_noindex_meta(document);
  const hasTitlePaywall = PAYWALL_PHRASES_TITLE.some((x) => title.includes(x));
  const hasBodyPaywallCopy = PAYWALL_PHRASES_BODY.some((x) => body.includes(x));

  if (text.length < MIN_ARTICLE_TEXT_LENGTH) {
    console.log(
      `Skipping short article body (${text.length} chars): ${
        sourceUrl || "unknown"
      }`
    );
    return true;
  }

  if (titleOnlyBlockers.some((x) => title.includes(x))) {
    return true;
  }

  // NEW: Skip the page early if it's a live feed or news brief page
  if (hasLiveFeedSignal) {
    console.log(`Skipping live feed/brief page: ${sourceUrl || "unknown"}`);
    return true;
  }

  // Title-only paywall phrases are reliable standalone signals.
  if (hasTitlePaywall) {
    return true;
  }

  // ld+json inaccessible + subscription copy in body → genuine paywall.
  // Either signal alone fires too many false positives on accessible pages.
  if (hasStructuredPaywallSignal && hasBodyPaywallCopy) {
    return true;
  }

  // Subscription copy + structural access blocker → paywall.
  if (hasBodyPaywallCopy && (hasNoIndex || hasLoginForm)) {
    return true;
  }

  // Many publishers render account/login widgets globally in headers.
  // Treat login forms as blockers only when there are additional paywall hints.
  if (hasLoginForm && hasNoIndex && hasAccessSignal) {
    return true;
  }

  if (hasNoIndex && hasAccessSignal) {
    return true;
  }

  if (ogType && ogType !== "article" && hasAccessSignal) {
    return true;
  }

  return false;
}

async function run_with_concurrency(items, worker, concurrency) {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let index = 0;

  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) {
        return;
      }
      await worker(items[current]);
    }
  });

  await Promise.all(runners);
}

async function fetch_data_from_ai(data) {
  // Canonical dedupe prevents duplicate rewrites for URL variants in one run.
  const uniqueItems = dedupe_items_by_canonical_url(data);

  await run_with_concurrency(
    uniqueItems,
    async (item) => {
      if (!(await check_if_item_not_exists(item.id))) {
        return;
      }

      const articleBody = await get_article_data(item.id);
      // Generate a random 3-digit number.
      let randomDigits = Math.random().toString(36).substr(2, 3);

      if (articleBody && articleBody.length !== 0) {
        const [rephrasedTitle, rephrasedDescription, rwBody] =
          await Promise.all([
            rephrase_data_from_openai(item.title, "title"),
            rephrase_data_from_openai(item.description || "", "description"),
            rephrase_data_from_openai(articleBody, "body"),
          ]);

        if (!rwBody) {
          console.log("AI rewrite returned empty body, skipping: " + item.id);

          await save_data_in_dynamoDb(item, {
            slug: randomDigits,
            rwError: "AI rewrite failed",
            rwTitle: item?.title,
          });
          return;
        }

        let slug = slugify(rephrasedTitle || item.title || "article", {
          lower: true,
          strict: true,
          replacement: "-",
        });

        const slugSuffix = `-${randomDigits}`;
        const maxSlugBaseLength = Math.max(
          1,
          SLUG_MAX_LENGTH - slugSuffix.length
        );
        if (slug.length > maxSlugBaseLength) {
          slug = slug.substring(0, maxSlugBaseLength);
        }

        slug = `${slug}${slugSuffix}`;

        const orgBody = articleBody;
        const classificationText = [
          item.title ? `Rubrik: ${item.title}` : "",
          item.description ? `Ingress: ${item.description}` : "",
          `Artikeltext:\n${orgBody}`,
        ]
          .filter(Boolean)
          .join("\n\n");

        // Attempt to classify subject via OpenAI and attach AI-assigned subject
        try {
          const autoSubjectId = await classify_subject_from_openai(
            classificationText,
            0.1
          );
          const hasExplicitSubjects =
            Array.isArray(item.subjects) && item.subjects.length > 0;
          console.log("AI subject classification result", {
            url: item.id,
            autoSubjectId,
            hasExplicitSubjects,
          });
          if (
            !hasExplicitSubjects &&
            Number.isFinite(autoSubjectId) &&
            autoSubjectId > 0
          ) {
            item.subjects = [{ id: Number(autoSubjectId), users: ["AI"] }];
            console.log("Assigned AI subject", autoSubjectId, "for", item.id);
          }
        } catch (err) {
          console.warn("Subject classification failed for", item.id, err);
        }

        // Attempt to classify subject via OpenAI and attach AI-assigned subject
        try {
          const autoSubjectId = await classify_subject_from_openai(
            orgBody,
            0.1
          );
          const hasExplicitSubjects =
            Array.isArray(item.subjects) && item.subjects.length > 0;
          if (
            !hasExplicitSubjects &&
            Number.isFinite(autoSubjectId) &&
            autoSubjectId > 0
          ) {
            item.subjects = [{ id: Number(autoSubjectId), users: ["AI"] }];
            console.log("Assigned AI subject", autoSubjectId, "for", item.id);
          }
        } catch (err) {
          console.warn("Subject classification failed for", item.id, err);
        }

        await save_data_in_dynamoDb(item, {
          rephrasedTitle,
          slug,
          rephrasedDescription,
          rwBody,
          orgBody,
          rwTitle: item?.title,
          rwDescription: item?.description,
        });
      } else {
        console.log("Skipping DB write — article body empty for: " + item.id);
        return; // ← skip DB write entirely
      }
    },
    ITEM_PROCESS_CONCURRENCY
  );
}

// Function to remove empty lines from text
const remove_empty_lines = function (text) {
  const lines = text.split("\n");
  const nonEmptyLines = lines.filter((line) => line.trim() !== "");
  return nonEmptyLines.join("\n");
};

function clean_article_text(text) {
  const lines = remove_empty_lines(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !should_drop_line(line));

  // Remove exact line duplicates while preserving original order.
  const deduped = [];
  const seen = new Set();

  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(line);
  }

  return deduped.join("\n");
}

// Function to fetch article data from URL
async function get_article_data(url) {
  try {
    const canonicalUrl = canonicalize_article_url(url);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(canonicalUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      console.log(
        `Skipping article due to non-OK response (${response.status}): ${canonicalUrl}`
      );
      return "";
    }

    const html = await response.text();
    const dom = new JSDOM(html, { virtualConsole: silentVirtualConsole });
    const document = dom.window.document;

    const summary = extract_article_body(document, canonicalUrl);
    if (!summary) {
      console.log("Url Item not scrapped: " + canonicalUrl);
      return "";
    }

    // Removing unwanted text
    const finalSummary = summary.replace(
      "Javascript är avstängtJavascript måste vara påslaget för att kunna spela videoLäs mer om webbläsarstöd",
      ""
    );

    // Cleanup before AI rewrite to reduce junk and token spend.
    const filterSummary = clean_article_text(finalSummary);
    if (!filterSummary) {
      console.log(
        "Skipping article, body empty after cleaning: " + canonicalUrl
      );
      return "";
    }

    if (is_likely_non_article_page(document, filterSummary, canonicalUrl)) {
      console.log("Likely non-article page skipped: " + canonicalUrl);
      return "";
    }

    return filterSummary;
  } catch (error) {
    console.error("Error fetching or parsing the HTML:", error);
    return null;
  }
}

// Function to get data from DynamoDB
const get_data_from_dynamoDb = async function () {
  // const dynamodb = new AWS.DynamoDB.DocumentClient();
  const tableName = defs.WN_STR_KEY_TABLE;
  const currentDateEpochTS = new Date().setHours(0, 0, 0, 0) / 1000;
  // const currentDateEpochTS = 1738281600;

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

  // const response = await dynamodb.scan(params).promise();
  let data = await Promise.all(
    rssUrls.map(async (url) => {
      const params = {
        TableName: tableName,
        IndexName: "sortKey-addedTS-index",
        ExpressionAttributeValues: {
          ":sortKey": url,
          ":end_date": currentDateEpochTS,
        },
        KeyConditionExpression: "sortKey = :sortKey and addedTS >= :end_date",
      };

      // const response = await dynamodb.scan(params).promise();
      const response = await dynamoDbLib.call("query", params);
      return response.Items;
    })
  );

  data = data.reduce((val, currVal) => [...val, ...currVal], []);

  console.log("DATA FROM DYNAMODB: ", data.length);
  return data;
};

// Function to save data in DynamoDB
const save_data_in_dynamoDb = async function (item, options = {}) {
  const {
    rephrasedTitle = null,
    slug = null,
    rephrasedDescription = null,
    rwBody = null,
    orgBody = null,
    rwAvailability = null,
    rwError = null,
    displayPermission = true,
    rwTitle = null,
    rwDescription = null,
    rwUserId = null,
    rwUserName = null,
    isRwDescription = null,
    isRwBody = null,
    isRwTitle = null,
    bodyUserId = null,
    descriptionUserId = null,
    titleUserId = null,
    nsURL = null,
  } = options;

  // const dynamodb = new AWS.DynamoDB.DocumentClient();
  const tableName = defs.WN_STR_KEY_TABLE;
  // const currentDate = new Date().toISOString().split("T")[0];

  let updateExpression =
    "set title=:rephrasedtitle, rwBody=:rwBody, description=:rephrasedescription, rwAvailability=:rwAvailability, rwError=:rwError, displayPermission=:displayPermission, addedTS=:addedTS, addedTSDbg=:addedTSDbg, amount=:amount, dislikes=:dislikes, distrust=:distrust, likes=:likes, link=:link, msgCount=:msgCount, pubDate=:pubDate, pubTS=:pubTS, rssUrl=:rssUrl, subjects=:subjects, support=:support, trust=:trust, ttlDbg=:ttlDbg, ttlTS=:ttlTS, rwTitle=:rwTitle, rwDescription=:rwDescription, rwUserId=:rwUserId, slug=:slug, orgBody=:orgBody, scrollByCount = if_not_exists(scrollByCount, :zeroCounter), openedCount = if_not_exists(openedCount, :zeroCounter), interestCount = if_not_exists(interestCount, :zeroCounter), uninterestCount = if_not_exists(uninterestCount, :zeroCounter)";

  let expressionAttributeValues = {
    ":rephrasedtitle": rephrasedTitle,
    ":rwBody": rwBody,
    ":rephrasedescription": rephrasedDescription,
    ":rwAvailability": rwAvailability,
    ":rwError": rwError,
    ":displayPermission": displayPermission,
    ":addedTS": item["addedTS"],
    ":addedTSDbg": item["addedTSDbg"],
    ":amount": item["amount"],
    ":dislikes": item["dislikes"],
    ":distrust": item["distrust"],
    ":likes": item["likes"],
    ":link": item["link"],
    ":msgCount": item["msgCount"],
    ":pubDate": item["pubDate"],
    ":pubTS": item["pubTS"] || null,
    ":rssUrl": item["rssUrl"],
    ":subjects": item["subjects"],
    ":support": item["support"],
    ":trust": item["trust"],
    ":ttlDbg": item["ttlDbg"],
    ":ttlTS": item["ttlTS"],
    ":rwTitle": rwTitle || null,
    ":rwDescription": rwDescription || null,
    ":rwUserId": rwUserId,
    ":slug": slug,
    ":orgBody": orgBody,
    ":zeroCounter": 0,
  };

  // Only include rwUserName if it exists
  if (rwUserName) {
    updateExpression += ", rwUserName=:rwUserName";
    expressionAttributeValues[":rwUserName"] = rwUserName;
  }

  updateExpression +=
    ", isRwDescription=:isRwDescription, isRwBody=:isRwBody, isRwTitle=:isRwTitle, bodyUserId=:bodyUserId, descriptionUserId=:descriptionUserId, titleUserId=:titleUserId, nsURL=:nsURL";
  expressionAttributeValues[":isRwDescription"] = isRwDescription;
  expressionAttributeValues[":isRwBody"] = isRwBody;
  expressionAttributeValues[":isRwTitle"] = isRwTitle;
  expressionAttributeValues[":bodyUserId"] = bodyUserId;
  expressionAttributeValues[":descriptionUserId"] = descriptionUserId;
  expressionAttributeValues[":titleUserId"] = titleUserId;
  expressionAttributeValues[":nsURL"] = nsURL;

  const params = {
    TableName: tableName,
    Key: { id: item["id"], sortKey: "articles" },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: "UPDATED_NEW",
  };

  try {
    const response = await dynamoDbLib.call("update", params);
    return response;
  } catch (error) {
    console.error(
      "Unable to update item. Error JSON:",
      JSON.stringify(error, null, 2)
    );
    throw error;
  }
};

// Function to check if item exists in DynamoDB
const check_if_item_not_exists = async function (id) {
  const TABLE_NAME = defs.WN_STR_KEY_TABLE;

  // const dynamodb = new AWS.DynamoDB.DocumentClient();
  const params = {
    TableName: TABLE_NAME,
    ProjectionExpression: "#id",
    ExpressionAttributeNames: { "#id": "id" },
    KeyConditionExpression: "id = :id",
    FilterExpression: "attribute_exists(rwAvailability)",
    ExpressionAttributeValues: {
      ":id": id,
    },
  };

  try {
    // const response = await dynamodb.query(params).promise();
    const response = await dynamoDbLib.call("query", params);

    if (response.Items.length === 0) {
      return true; // Item does not exist
    } else {
      return false; // Item exists
    }
  } catch (err) {
    if (err.code === "ValidationException") {
      console.warn(
        "There's a validation error. Here's the message:",
        err.message
      );
    } else {
      console.error(
        "Couldn't query for item. Here's why:",
        err.code,
        err.message
      );
      throw err;
    }
  }
};

export const __testables = {
  canonicalize_article_url,
  should_drop_line,
  clean_article_text,
  is_likely_non_article_page,
};

// Lambda handler function
export async function main() {
  console.log("DATA SCRAPPING NODE CALLED: ", new Date().toISOString());
  const data = await get_data_from_dynamoDb(); // Fetching data from DynamoDB
  await fetch_data_from_ai(data); // Fetching data from AI
  return {
    statusCode: 200,
    body: {
      response: "success",
    },
  };
}
