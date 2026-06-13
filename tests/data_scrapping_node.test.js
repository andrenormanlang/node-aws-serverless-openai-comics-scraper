import { main as addArticlesMain } from "../src/functions/add_articles";
import {
  main as dataScrappingMain,
  __testables,
} from "../src/functions/data_scrapping_node";
import * as dynamoDbLib from "../src/libs/dynamodb-lib";
import * as dlXmlUtils from "../src/libs/dl_xml_utils";
import fetch from "node-fetch";
import { load as cheerioLoad } from "cheerio";
import {
  rephrase_data_from_openai,
  classify_subject_from_openai,
} from "../src/libs/rephrase-lib";

jest.mock("../src/libs/dynamodb-lib");
jest.mock("../src/libs/dl_xml_utils");
jest.mock("node-fetch");
jest.mock("../src/libs/rephrase-lib");

const {
  canonicalize_article_url,
  should_drop_line,
  clean_article_text,
  is_likely_non_article_page,
} = __testables;

const rssItemsBySortKey = new Map();
const rewrittenIds = new Set();
const updateParams = [];

const GOOD_CANONICAL_URL = "https://bleedingcool.com/comics/sample-article";
const GOOD_VARIANT_URL =
  "https://bleedingcool.com/comics/sample-article?utm_source=newsletter&utm_medium=email";
const PAYWALL_VARIANT_URL = "https://bleedingcool.com/paywall-article?utm_source=feed";
const PAYWALL_CANONICAL_URL = "https://bleedingcool.com/paywall-article";

function buildRssItem(link, title = "Example title") {
  return {
    title,
    link,
    pubDate: "Mon, 3 Jun 2024 00:06:05 +0200",
    description: "Example rss description",
  };
}

function totalStoredItems() {
  return Array.from(rssItemsBySortKey.values()).reduce(
    (sum, items) => sum + items.length,
    0
  );
}

beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
  console.log.mockRestore();
  console.error.mockRestore();
  console.warn.mockRestore();
});

beforeEach(() => {
  rssItemsBySortKey.clear();
  rewrittenIds.clear();
  updateParams.length = 0;

  dynamoDbLib.now.mockReset();
  dynamoDbLib.tsToDbgStr.mockReset();
  dynamoDbLib.ttlTS.mockReset();
  dynamoDbLib.doBatchWrite.mockReset();
  dynamoDbLib.call.mockReset();

  dlXmlUtils.downloadData.mockReset();
  dlXmlUtils.getXmlChannelNodeFromXMLString.mockReset();
  dlXmlUtils.extractNewsDataFromXMLChannelNode.mockReset();
  dlXmlUtils.parseStrTimestamp.mockReset();
  dlXmlUtils.formatTSObj.mockReset();
  dlXmlUtils.getTimestampFromFormattedTimestamp.mockReset();
  dlXmlUtils.cleanAttribs.mockReset();

  fetch.mockReset();
  rephrase_data_from_openai.mockReset();
  classify_subject_from_openai.mockReset();

  dynamoDbLib.now.mockReturnValue(1710000000);
  dynamoDbLib.tsToDbgStr.mockImplementation((ts) => String(ts));
  dynamoDbLib.ttlTS.mockImplementation(() => 1710003600);

  dynamoDbLib.doBatchWrite.mockImplementation(async (_table, items) => {
    for (const item of items) {
      const key = item.sortKey;
      const existing = rssItemsBySortKey.get(key) || [];
      existing.push(item);
      rssItemsBySortKey.set(key, existing);
    }
    return { UnprocessedItems: {} };
  });

  dynamoDbLib.call.mockImplementation(async (method, params) => {
    if (method === "get") {
      return { Item: undefined };
    }

    if (method === "put") {
      return { ok: true };
    }

    if (method === "query") {
      if (
        params.KeyConditionExpression &&
        params.KeyConditionExpression.includes("sortKey = :sortKey")
      ) {
        const sortKey = params.ExpressionAttributeValues[":sortKey"];
        return { Items: rssItemsBySortKey.get(sortKey) || [] };
      }

      if (params.KeyConditionExpression === "id = :id") {
        const id = params.ExpressionAttributeValues[":id"];
        return { Items: rewrittenIds.has(id) ? [{ id }] : [] };
      }

      return { Items: [] };
    }

    if (method === "update") {
      rewrittenIds.add(params.Key.id);
      updateParams.push(params);
      return { Attributes: {} };
    }

    return {};
  });

  dlXmlUtils.downloadData.mockImplementation(async (rssUrl) => rssUrl);
  dlXmlUtils.getXmlChannelNodeFromXMLString.mockImplementation((raw) => ({
    rssUrl: raw,
  }));

  // Provide add_articles with deterministic RSS rows.
  // bleedingcool.com/feed/ emits multiple items to test deduplication and
  // paywall filtering; all other feeds emit a single duplicate URL variant.
  dlXmlUtils.extractNewsDataFromXMLChannelNode.mockImplementation(
    (channelNode) => {
      const rssUrl = channelNode.rssUrl;

      if (rssUrl.includes("bleedingcool.com/feed")) {
        return {
          items: [
            buildRssItem(GOOD_VARIANT_URL, "BC good variant"),
            buildRssItem(GOOD_CANONICAL_URL, "BC good canonical"),
            buildRssItem(PAYWALL_VARIANT_URL, "BC paywall"),
          ],
          channelHeader: {
            title: "Bleeding Cool",
            description: "BC feed",
            lastBuildDate: "Mon, 3 Jun 2024 00:06:05 +0200",
            imageUrl: "https://example.com/bc.jpg",
          },
        };
      }

      // All other feeds emit a duplicate URL variant to test cross-feed dedupe efficiency.
      return {
        items: [buildRssItem(GOOD_VARIANT_URL, "Shared duplicate")],
        channelHeader: {
          title: "Other",
          description: "Other feed",
          lastBuildDate: "Mon, 3 Jun 2024 00:06:05 +0200",
          imageUrl: "https://example.com/other.jpg",
        },
      };
    }
  );

  dlXmlUtils.parseStrTimestamp.mockReturnValue({
    day: "3",
    month: 6,
    year: "2024",
    hour: "00",
    minute: "06",
    second: "05",
  });
  dlXmlUtils.formatTSObj.mockReturnValue("2024-06-03 00:06:05");
  dlXmlUtils.getTimestampFromFormattedTimestamp.mockReturnValue(1710000100);
  dlXmlUtils.cleanAttribs.mockImplementation(() => {});

  const goodArticleBody = [
    "This is the first long paragraph with enough factual content to be treated as real article text.",
    "Photo: TT",
    "Image caption: Crowd at the station",
    "Read more",
    "https://example.com/source",
    "www.example.com/related",
    "Follow us on Facebook",
    "open image in full screen",
    "Navigation | News | Sport",
    "Duplicate line should only remain once.",
    "Duplicate line should only remain once.",
    "This is the second long paragraph with additional details, names, numbers, and context to exceed thresholds.",
    "This is the third long paragraph with timeline and extra context so the final cleaned article remains comfortably above minimum length checks.",
    "This is the fourth long paragraph to ensure the resulting content is long enough even after removing noisy lines from scraping.",
    "This is the fifth long paragraph that confirms the cleaner preserves meaningful narrative while removing only obvious junk lines.",
    "This is the sixth long paragraph adding further background, sourcing, and explanation so the article is unambiguously above the minimum length.",
    "This is the seventh long paragraph with closing context, reactions, and additional factual detail to keep the body well clear of the threshold.",
  ].join("\n");

  const goodHtml = `<html><head><title>News article</title></head><body><article>${goodArticleBody}</article></body></html>`;
  const paywallHtml =
    "<html><head><title>Logga in for att lasa</title></head><body><article>Kort text</article></body></html>";

  fetch.mockImplementation(async (url) => {
    if (url === GOOD_CANONICAL_URL) {
      return {
        ok: true,
        status: 200,
        text: async () => goodHtml,
      };
    }

    if (url === PAYWALL_CANONICAL_URL) {
      return {
        ok: true,
        status: 200,
        text: async () => paywallHtml,
      };
    }

    return {
      ok: false,
      status: 404,
      text: async () => "",
    };
  });

  rephrase_data_from_openai.mockImplementation(async (input, key) => {
    if (key === "title") {
      return `rewritten-title-${"x".repeat(180)}`;
    }

    return `rewritten-body-${String(input).slice(0, 20)}`;
  });

  classify_subject_from_openai.mockResolvedValue(57);
});

describe("data_scrapping_node improvements with add_articles integration", () => {
  test("dedupes URLs, removes scraping junk, rejects non-article pages, and limits AI calls", async () => {
    await addArticlesMain();

    // Integration checkpoint: add_articles should have produced many RSS rows.
    expect(totalStoredItems()).toBeGreaterThan(10);

    const result = await dataScrappingMain();
    expect(result.statusCode).toBe(200);

    // Efficiency: despite many source rows, only unique canonical URLs are fetched.
    expect(fetch).toHaveBeenCalledTimes(2);

    // Only one valid article is rewritten => 3 calls (title + description + body).
    expect(rephrase_data_from_openai).toHaveBeenCalledTimes(3);
    expect(classify_subject_from_openai).toHaveBeenCalledTimes(1);

    // We expect one successful rewrite update; non-article pages are skipped.
    expect(updateParams).toHaveLength(1);

    const successfulUpdate = updateParams.find(
      (p) => p.ExpressionAttributeValues[":rwError"] === null
    );
    expect(successfulUpdate).toBeDefined();

    const cleanedBody = successfulUpdate.ExpressionAttributeValues[":orgBody"];
    const rewrittenSlug = successfulUpdate.ExpressionAttributeValues[":slug"];

    const classifierInput = classify_subject_from_openai.mock.calls[0][0];
    expect(classify_subject_from_openai).toHaveBeenCalledWith(
      expect.stringContaining(cleanedBody),
      0.1
    );
    expect(classifierInput).toMatch(/Rubrik:/);
    expect(classifierInput).toMatch(/Ingress:/);
    expect(classifierInput).toMatch(/Artikeltext:/);
    expect(successfulUpdate.ExpressionAttributeValues[":subjects"]).toEqual([
      {
        id: 57,
        users: ["AI"],
      },
    ]);
    expect(rewrittenSlug.length).toBeLessThanOrEqual(100);
    expect(cleanedBody).not.toMatch(/photo\s*:/i);
    expect(cleanedBody.toLowerCase()).not.toContain("image caption");
    expect(cleanedBody.toLowerCase()).not.toContain("read more");
    expect(cleanedBody.toLowerCase()).not.toContain("https://");
    expect(cleanedBody.toLowerCase()).not.toContain("www.example.com/related");
    expect(cleanedBody.toLowerCase()).not.toContain("follow us");
    expect(cleanedBody.toLowerCase()).not.toContain("open image in full screen");
    expect(cleanedBody.toLowerCase()).not.toContain("navigation |");
    expect(
      (cleanedBody.match(/Duplicate line should only remain once\./g) || [])
        .length
    ).toBe(1);

    // Original RSS item IDs are stored so the articles record shares the same id
    // as the RSS record created by add_articles. Deduplication uses canonical URLs
    // internally but does not overwrite item.id before saving.
    expect(Array.from(rewrittenIds)).toContain(GOOD_VARIANT_URL);
    expect(Array.from(rewrittenIds)).not.toContain(PAYWALL_VARIANT_URL);
    // The duplicate canonical URL is deduped and never separately stored.
    expect(Array.from(rewrittenIds)).not.toContain(GOOD_CANONICAL_URL);
  });
});

describe("data_scrapping_node helper unit tests", () => {
  test("canonicalize_article_url removes tracking params, hash, and trailing slash", () => {
    const input =
      "https://bleedingcool.com/comics/sample-article/?utm_source=newsletter&utm_medium=email&keep=1#hero";

    expect(canonicalize_article_url(input)).toBe(
      "https://bleedingcool.com/comics/sample-article?keep=1"
    );
  });

  test("canonicalize_article_url returns input for invalid urls", () => {
    const input = "not a url";
    expect(canonicalize_article_url(input)).toBe(input);
  });

  test("should_drop_line removes obvious link and CTA noise", () => {
    expect(should_drop_line("Länkar: https://example.com/kalla")).toBe(true);
    expect(should_drop_line("www.example.com/relaterat")).toBe(true);
    expect(should_drop_line("Detta är en vanlig nyhetsrad med fakta.")).toBe(
      false
    );
  });

  test("clean_article_text strips junk lines and dedupes repeated lines", () => {
    const raw = [
      "",
      "Photo: TT",
      "Read more",
      "This line stays.",
      "This line stays.",
      "open image in full screen",
      "Second factual line stays.",
    ].join("\n");

    const cleaned = clean_article_text(raw);
    expect(cleaned).toBe("This line stays.\nSecond factual line stays.");
  });

  test("is_likely_non_article_page avoids false positives from generic words in body", () => {
    const html =
      '<html><head><title>Policy analysis</title><meta property="og:type" content="article" /></head><body><article>ok</article></body></html>';
    const $ = cheerioLoad(html);
    const text = (
      "The political analysis discusses a proposed 404 reform and quotes the phrase access denied in context. " +
      "This is still a normal article body with factual content and no paywall signals. "
    ).repeat(6);

    expect(is_likely_non_article_page($, text)).toBe(false);
  });

  test("is_likely_non_article_page detects ld+json paywall signal", () => {
    const html = `
      <html>
        <head>
          <title>Members only</title>
          <meta property="og:type" content="article" />
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"NewsArticle","isAccessibleForFree":false}
          </script>
        </head>
        <body><article>content</article></body>
      </html>
    `;

    const $ = cheerioLoad(html);
    const text = (
      "This is a longer article body with several sentences exceeding the minimum length threshold. " +
      "Subscription terms for digital access apply to this article content. "
    ).repeat(8);

    expect(is_likely_non_article_page($, text)).toBe(true);
  });

  test("is_likely_non_article_page keeps article pages with login promo blocks", () => {
    const html = `
      <html>
        <head>
          <title>New images from NASA show unseen parts of the moon</title>
          <meta property="og:type" content="article" />
        </head>
        <body>
          <article>
            New images from NASA show parts of the moon that no one has ever seen before.
            The images were taken during the Artemis II rocket's passage over the far side of the moon.
            Get more out of the site when logged in. Log in. Create a free account. Subscribe.
          </article>
        </body>
      </html>
    `;

    const $ = cheerioLoad(html);
    const text = (
      "New images from NASA show parts of the moon that no one has ever seen before. " +
      "The images were taken during the Artemis II rocket passage over the far side of the moon. " +
      "Get more out of the site when logged in. Create a free account. Subscribe. "
    ).repeat(8);

    expect(is_likely_non_article_page($, text)).toBe(false);
  });

  test("is_likely_non_article_page does not reject pages with global login widget only", () => {
    const html = `
      <html>
        <head>
          <title>Latest comics news</title>
          <meta property="og:type" content="article" />
        </head>
        <body>
          <header>
            <form action="/account/login"><input type="password" /></form>
          </header>
          <article>
            A longer comics news article with several paragraphs and factual information.
            The text continues with more details about plot, background, and consequences.
          </article>
        </body>
      </html>
    `;

    const $ = cheerioLoad(html);
    const text = (
      "A longer comics news article with several paragraphs and factual information. " +
      "The text continues with more details about plot, background, and consequences. "
    ).repeat(8);

    // A login widget alone (without noindex + access signal) must NOT cause rejection.
    expect(is_likely_non_article_page($, text)).toBe(false);
  });

  test("is_likely_non_article_page rejects pages with explicit paywall copy and noindex", () => {
    const html = `
      <html>
        <head>
          <title>Premium comics coverage</title>
          <meta name="robots" content="noindex" />
          <meta property="og:type" content="article" />
        </head>
        <body>
          <article>
            Subscribe to continue reading exclusive comics analysis and insider insights.
          </article>
        </body>
      </html>
    `;

    const $ = cheerioLoad(html);
    const text = (
      "Subscribe to continue reading exclusive comics analysis and insider insights. " +
      "This content is available to subscribers only. "
    ).repeat(6);

    expect(is_likely_non_article_page($, text)).toBe(true);
  });
});
