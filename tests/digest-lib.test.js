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

// Highlights cite sources by 1-based article number.
function makeHighlights(count) {
  return Array.from({ length: count }, (_, i) => ({
    publisher: "DC",
    topic: "relaunch",
    headline: `Headline ${i}`,
    summary: `Summary ${i}`,
    sources: [(i % ARTICLES.length) + 1],
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
    expect(malmoDate(new Date("2026-06-22T01:30:00Z"))).toBe("2026-06-22");
    // 23:30Z is already the next day locally (01:30 CEST) — rolls over at Malmö midnight.
    expect(malmoDate(new Date("2026-06-21T23:30:00Z"))).toBe("2026-06-22");
  });
});

describe("validateDigest", () => {
  test("resolves integer sources to { title, url } for 5 valid highlights", () => {
    const result = validateDigest({ highlights: makeHighlights(5) }, ARTICLES);
    expect(result).toHaveLength(5);
    expect(result[0].sources[0]).toEqual({
      title: "Title 0",
      url: "https://example.com/a0",
    });
  });

  test("caps at 5 when the model returns more", () => {
    const result = validateDigest({ highlights: makeHighlights(8) }, ARTICLES);
    expect(result).toHaveLength(5);
  });

  test("keeps valid highlights and drops ones with no resolvable source", () => {
    const hs = makeHighlights(5);
    hs[0].sources = [999]; // out of range → highlight dropped, others kept
    const result = validateDigest({ highlights: hs }, ARTICLES);
    expect(result).toHaveLength(4);
  });

  test("returns null when no highlight is usable", () => {
    const hs = makeHighlights(3).map((h) => ({ ...h, sources: [999] }));
    expect(validateDigest({ highlights: hs }, ARTICLES)).toBeNull();
    expect(validateDigest({ highlights: [] }, ARTICLES)).toBeNull();
  });

  test("skips highlights missing required text", () => {
    const hs = makeHighlights(5);
    delete hs[2].summary;
    expect(validateDigest({ highlights: hs }, ARTICLES)).toHaveLength(4);
  });
});

describe("buildDigestPrompt", () => {
  test("numbers entries with source + title, and skips entries without a title", () => {
    const prompt = buildDigestPrompt([
      ...ARTICLES,
      { id: "https://x/y", rssUrl: "https://x.com" }, // no title → skipped
    ]);
    const lines = prompt.split("\n");
    expect(lines).toHaveLength(ARTICLES.length);
    expect(lines[0]).toContain("[1]");
    expect(lines[0]).toContain("(src0.com)");
    expect(lines[0]).toContain("Title 0");
  });
});

describe("generateDigest", () => {
  test("returns the existing digest without calling OpenAI", async () => {
    dynamoDbLib.call.mockResolvedValueOnce({
      Item: { id: "digest", highlights: [] },
    });

    const result = await generateDigest({ force: false });

    expect(result).toEqual({ id: "digest", highlights: [] });
    expect(fetch).not.toHaveBeenCalled();
    expect(dynamoDbLib.fetchRecentArticles).not.toHaveBeenCalled();
  });

  test("returns null when there are no recent articles", async () => {
    dynamoDbLib.call.mockResolvedValueOnce({ Item: undefined });
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
          { message: { content: JSON.stringify({ highlights: makeHighlights(5) }) } },
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
    dynamoDbLib.call.mockResolvedValueOnce({ Item: undefined });
    dynamoDbLib.fetchRecentArticles.mockResolvedValueOnce(ARTICLES);
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ highlights: [] }) } }],
      }),
    });

    const result = await generateDigest({ force: false });

    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
