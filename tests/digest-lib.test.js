import {
  generateDigest,
  buildDigestPrompt,
  malmoDate,
} from "../src/libs/digest-lib";
import { validateDigest } from "../src/libs/digest-schema";
import * as dynamoDbLib from "../src/libs/dynamodb-lib";
import { getGptConfig } from "../src/libs/gpt-config";
import fetch from "node-fetch";

jest.mock("../src/libs/dynamodb-lib");
jest.mock("../src/libs/gpt-config");
jest.mock("node-fetch", () => jest.fn());

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

const ARTICLES = Array.from({ length: 6 }, (_, i) => ({
  id: `https://example.com/a${i}`,
  rwTitle: `Title ${i}`,
  rwDescription: `Desc ${i}`,
  rssUrl: `https://src${i % 3}.com/feed/`,
  pubTS: 1000 + i,
  amount: 1000 + i,
}));

const ALLOWED = new Set(ARTICLES.map((a) => a.id));

function makeHighlights(urls) {
  return Array.from({ length: 5 }, (_, i) => ({
    publisher: "DC",
    topic: "relaunch",
    headline: `Headline ${i}`,
    summary: `Summary ${i}`,
    sources: [{ title: `Source ${i}`, url: urls[i % urls.length] }],
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  dynamoDbLib.now.mockReturnValue(100000);
  dynamoDbLib.ttlTS.mockReturnValue(200000);
  dynamoDbLib.tsToDbgStr.mockReturnValue("dbg");
  getGptConfig.mockResolvedValue({
    gptModelLong: "gpt-4o",
    gptModelShort: "gpt-4o-mini",
  });
});

describe("malmoDate", () => {
  test("formats a fixed instant as the Malmö (Europe/Stockholm) ISO date", () => {
    // 2026-06-22T01:30Z is still 2026-06-22 in CEST (UTC+2).
    expect(malmoDate(new Date("2026-06-22T01:30:00Z"))).toBe("2026-06-22");
    // 2026-06-21T23:30Z is already 2026-06-22 locally (01:30 CEST) — rolls over at Malmö midnight.
    expect(malmoDate(new Date("2026-06-21T23:30:00Z"))).toBe("2026-06-22");
  });
});

describe("validateDigest", () => {
  test("accepts exactly 5 valid highlights", () => {
    const result = validateDigest(
      { highlights: makeHighlights([...ALLOWED]) },
      ALLOWED
    );
    expect(result).toHaveLength(5);
  });

  test("rejects when not exactly 5 highlights", () => {
    const four = makeHighlights([...ALLOWED]).slice(0, 4);
    expect(validateDigest({ highlights: four }, ALLOWED)).toBeNull();
  });

  test("rejects when a highlight has only invented (out-of-set) urls", () => {
    const hs = makeHighlights([...ALLOWED]);
    hs[0].sources = [{ title: "x", url: "https://evil.com/invented" }];
    expect(validateDigest({ highlights: hs }, ALLOWED)).toBeNull();
  });

  test("rejects missing required string fields", () => {
    const hs = makeHighlights([...ALLOWED]);
    delete hs[2].summary;
    expect(validateDigest({ highlights: hs }, ALLOWED)).toBeNull();
  });
});

describe("buildDigestPrompt", () => {
  test("includes source label, title and url; skips entries without a title", () => {
    const prompt = buildDigestPrompt([
      ...ARTICLES,
      { id: "https://x/y", rssUrl: "https://x.com" }, // no title → skipped
    ]);
    expect(prompt).toContain("Title 0");
    expect(prompt).toContain("url: https://example.com/a0");
    expect(prompt).toContain("[src0.com]");
    expect(prompt).not.toContain("url: https://x/y");
  });
});

describe("generateDigest", () => {
  test("returns the existing digest without calling OpenAI", async () => {
    dynamoDbLib.call.mockResolvedValueOnce({
      Item: { id: "digest", highlights: [] },
    }); // getTodaysDigest

    const result = await generateDigest({ force: false });

    expect(result).toEqual({ id: "digest", highlights: [] });
    expect(fetch).not.toHaveBeenCalled();
    expect(dynamoDbLib.fetchRecentArticles).not.toHaveBeenCalled();
  });

  test("returns null when there are no recent articles", async () => {
    dynamoDbLib.call.mockResolvedValueOnce({ Item: undefined }); // getTodaysDigest
    dynamoDbLib.fetchRecentArticles.mockResolvedValueOnce([]);

    const result = await generateDigest({ force: false });

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("generates, validates, and stores a 5-highlight digest", async () => {
    dynamoDbLib.call
      .mockResolvedValueOnce({ Item: undefined }) // getTodaysDigest → none
      .mockResolvedValueOnce({}); // put
    dynamoDbLib.fetchRecentArticles.mockResolvedValueOnce(ARTICLES);
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                highlights: makeHighlights([...ALLOWED]),
              }),
            },
          },
        ],
      }),
    });

    const result = await generateDigest({ force: false });

    expect(result).not.toBeNull();
    expect(result.id).toBe("digest");
    expect(result.highlights).toHaveLength(5);
    expect(result.articleCount).toBe(ARTICLES.length);
    expect(dynamoDbLib.call).toHaveBeenCalledWith(
      "put",
      expect.objectContaining({
        Item: expect.objectContaining({ id: "digest" }),
      })
    );
  });

  test("retries once on an invalid payload, then degrades to null", async () => {
    dynamoDbLib.call.mockResolvedValueOnce({ Item: undefined }); // getTodaysDigest → none
    dynamoDbLib.fetchRecentArticles.mockResolvedValueOnce(ARTICLES);
    const badResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ highlights: [] }) } }],
      }),
    };
    fetch.mockResolvedValue(badResponse);

    const result = await generateDigest({ force: false });

    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2); // initial + one corrective retry
  });
});
