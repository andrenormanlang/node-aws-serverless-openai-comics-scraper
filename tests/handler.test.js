import { main } from "../src/handlers/get";
import * as dynamoDbLib from "../src/libs/dynamodb-lib";

jest.mock("../src/libs/dynamodb-lib");
jest.mock("../src/libs/defs", () => ({
  WN_STR_KEY_TABLE: "test-table",
  WN_STR_KEY_AMOUNT_INDEX: "sortKey-amount-index",
  GET_NEWS_FEED_MAX_LIMIT: 100,
}));

function makeArticle(overrides = {}) {
  return {
    id: "https://example.com/article1",
    trust: { users: [] },
    distrust: { users: [] },
    likes: { users: [] },
    dislikes: { users: [] },
    support: [],
    subjects: [],
    interestCount: 0,
    uninterestCount: 0,
    ...overrides,
  };
}

function makeEvent(rssUrl, userId = null) {
  return {
    requestContext: userId ? { identity: { cognitoIdentityId: userId } } : {},
    pathParameters: {
      url: encodeURIComponent(JSON.stringify({ rssUrl })),
    },
  };
}

describe("get handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns shaped articles with correct like/dislike counts", async () => {
    const article = makeArticle({ interestCount: 3, uninterestCount: 1 });

    dynamoDbLib.doQueryNewsFeed.mockResolvedValueOnce([article]);
    dynamoDbLib.call.mockResolvedValueOnce({ Items: [] });

    const result = await main(makeEvent("https://cbr.com/feed/", "user-1"));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].likes).toEqual({ amount: 3, status: false });
    expect(body.items[0].dislikes).toEqual({ amount: 1, status: false });
    expect(body.items[0].comments).toBe(0);
  });

  it("filters deleted comments and counts only active ones", async () => {
    const article = makeArticle();

    dynamoDbLib.doQueryNewsFeed.mockResolvedValueOnce([article]);
    dynamoDbLib.call.mockResolvedValueOnce({
      Items: [
        { deleted: false, support: [] },
        { deleted: true, support: [] },
        { deleted: false, support: ["user-1"] },
      ],
    });

    const result = await main(makeEvent("https://cbr.com/feed/", "user-1"));

    const body = JSON.parse(result.body);
    expect(body.items[0].comments).toBe(2);
  });

  it("handles unauthenticated request (null userId)", async () => {
    const article = makeArticle({
      trust: { users: ["user-x"] },
      subjects: [{ id: 1, users: ["user-x"] }],
    });

    dynamoDbLib.doQueryNewsFeed.mockResolvedValueOnce([article]);
    dynamoDbLib.call.mockResolvedValueOnce({ Items: [] });

    const result = await main(makeEvent("https://cbr.com/feed/"));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items[0].trust).toEqual({ amount: 1, status: false });
    expect(body.items[0].subjects[0]).toEqual({ id: 1, users: 1, status: false });
  });

  it("shapes subjects with per-user status", async () => {
    const article = makeArticle({
      subjects: [{ id: 42, users: ["user-1", "user-2"] }],
    });

    dynamoDbLib.doQueryNewsFeed.mockResolvedValueOnce([article]);
    dynamoDbLib.call.mockResolvedValueOnce({ Items: [] });

    const result = await main(makeEvent("https://cbr.com/feed/", "user-1"));

    const body = JSON.parse(result.body);
    expect(body.items[0].subjects).toEqual([{ id: 42, users: 2, status: true }]);
  });
});
