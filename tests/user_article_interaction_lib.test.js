import * as dynamoDbLib from "../src/libs/dynamodb-lib";
import * as defs from "../src/libs/defs";
import * as interactionLib from "../src/libs/user_article_interaction_lib";

// Mock dynamoDbLib
jest.mock("../src/libs/dynamodb-lib");
jest.mock("../src/libs/defs", () => ({
  WN_STR_KEY_TABLE: "test-table",
  ARTICLE_LEGACY_THRESHOLD_DAYS: 8,
}));

const EIGHT_DAYS_SECONDS = 8 * 24 * 60 * 60;
const NOW = Math.floor(Date.now() / 1000);

// Helper to create a fresh article with all required counters
function createFreshArticle(overrides = {}) {
  return {
    id: "article-1",
    sortKey: "articles",
    addedTS: NOW - 1000,
    scrollByCount: 0,
    openedCount: 0,
    interestCount: 0,
    uninterestCount: 0,
    ...overrides,
  };
}

describe("user_article_interaction_lib", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getOrCreateUserArticle", () => {
    it("should return 'Old article' if article is older than 8 days", async () => {
      const oldArticleAddedTS = NOW - (EIGHT_DAYS_SECONDS + 100);
      const article = createFreshArticle({ addedTS: oldArticleAddedTS });

      dynamoDbLib.call.mockResolvedValueOnce({ Item: article });

      const result = await interactionLib.getOrCreateUserArticle({
        userId: "user-1",
        articleId: "article-1",
        interaction: "scrollBy",
      });

      expect(result.resultType).toBe("oldArticle");
      expect(result.message).toBe("Old article");
    });

    it("should return 'Old article' if article has no scrollByCount (legacy)", async () => {
      const article = {
        id: "article-1",
        sortKey: "articles",
        addedTS: NOW - 100,
        // scrollByCount missing
      };

      dynamoDbLib.call.mockResolvedValueOnce({ Item: article });

      const result = await interactionLib.getOrCreateUserArticle({
        userId: "user-1",
        articleId: "article-1",
        interaction: "scrollBy",
      });

      expect(result.resultType).toBe("oldArticle");
      expect(result.message).toBe("Old article");
    });

    it("should create new user-article item if none exists", async () => {
      const article = createFreshArticle();

      dynamoDbLib.call
        .mockResolvedValueOnce({ Item: article }) // getArticleItem
        .mockResolvedValueOnce({ Item: null }) // getExistingUserArticle
        .mockResolvedValueOnce({}); // transactWrite

      const result = await interactionLib.getOrCreateUserArticle({
        userId: "user-1",
        articleId: "article-1",
        interaction: "scrollBy",
      });

      expect(result.resultType).toBe("created");
      expect(result.message).toBe("none to scrollBy");

      // Verify transactWrite was called with correct structure
      expect(dynamoDbLib.call).toHaveBeenCalledWith(
        "transactWrite",
        expect.objectContaining({
          TransactItems: expect.arrayContaining([
            expect.objectContaining({
              Put: expect.any(Object),
            }),
            expect.objectContaining({
              Update: expect.any(Object),
            }),
          ]),
        })
      );
    });

    it("should return existing interaction if user-article already exists", async () => {
      const article = createFreshArticle();

      const userArticle = {
        id: "user-1",
        sortKey: "user-article#article-1",
        interaction: "scrollBy",
        userArticleTS: NOW - 500,
      };

      dynamoDbLib.call
        .mockResolvedValueOnce({ Item: article }) // getArticleItem
        .mockResolvedValueOnce({ Item: userArticle }); // getExistingUserArticle

      const result = await interactionLib.getOrCreateUserArticle({
        userId: "user-1",
        articleId: "article-1",
        interaction: "scrollBy",
      });

      expect(result.resultType).toBe("existing");
      expect(result.existingInteraction).toBe("scrollBy");
    });

    it("should throw error for invalid interaction type", async () => {
      await expect(
        interactionLib.getOrCreateUserArticle({
          userId: "user-1",
          articleId: "article-1",
          interaction: "invalid",
        })
      ).rejects.toThrow("Invalid interaction: invalid");
    });
  });

  describe("registerScrollByEvent", () => {
    it("should return 'none to scrollBy' when creating new interaction", async () => {
      const article = createFreshArticle();

      dynamoDbLib.call
        .mockResolvedValueOnce({ Item: article })
        .mockResolvedValueOnce({ Item: null })
        .mockResolvedValueOnce({});

      const result = await interactionLib.registerScrollByEvent({
        userId: "user-1",
        articleId: "article-1",
      });

      expect(result).toBe("none to scrollBy");
    });

    it("should update timestamp if interaction is already scrollBy", async () => {
      const article = createFreshArticle({ scrollByCount: 1 });

      const userArticle = {
        id: "user-1",
        sortKey: "user-article#article-1",
        interaction: "scrollBy",
        userArticleTS: NOW - 500,
      };

      dynamoDbLib.call
        .mockResolvedValueOnce({ Item: article })
        .mockResolvedValueOnce({ Item: userArticle })
        .mockResolvedValueOnce({}); // update

      const result = await interactionLib.registerScrollByEvent({
        userId: "user-1",
        articleId: "article-1",
      });

      expect(result).toBe("scrollBy timestamp updated");
    });

    it("should return 'no changes' if existing interaction is opened", async () => {
      const article = createFreshArticle({ scrollByCount: 1, openedCount: 1 });

      const userArticle = {
        id: "user-1",
        sortKey: "user-article#article-1",
        interaction: "opened",
        userArticleTS: NOW - 500,
      };

      dynamoDbLib.call
        .mockResolvedValueOnce({ Item: article })
        .mockResolvedValueOnce({ Item: userArticle });

      const result = await interactionLib.registerScrollByEvent({
        userId: "user-1",
        articleId: "article-1",
      });

      expect(result).toBe("no changes");
    });

    it("should return 'no changes' if existing interaction is interest vote", async () => {
      const article = createFreshArticle({ interestCount: 1 });

      const userArticle = {
        id: "user-1",
        sortKey: "user-article#article-1",
        interaction: "interest",
        userArticleTS: NOW - 500,
      };

      dynamoDbLib.call
        .mockResolvedValueOnce({ Item: article })
        .mockResolvedValueOnce({ Item: userArticle });

      const result = await interactionLib.registerScrollByEvent({
        userId: "user-1",
        articleId: "article-1",
      });

      expect(result).toBe("no changes");
    });
  });

  describe("registerOpenedEvent", () => {
    it("should transition from scrollBy to opened and update counters", async () => {
      const article = createFreshArticle({ scrollByCount: 1 });

      const userArticle = {
        id: "user-1",
        sortKey: "user-article#article-1",
        interaction: "scrollBy",
        userArticleTS: NOW - 500,
      };

      dynamoDbLib.call
        .mockResolvedValueOnce({ Item: article })
        .mockResolvedValueOnce({ Item: userArticle })
        .mockResolvedValueOnce({}); // transactWrite

      const result = await interactionLib.registerOpenedEvent({
        userId: "user-1",
        articleId: "article-1",
      });

      expect(result).toBe("scrollBy to opened");
    });

    it("should only update timestamp if interaction is already opened", async () => {
      const article = createFreshArticle({ openedCount: 1 });

      const userArticle = {
        id: "user-1",
        sortKey: "user-article#article-1",
        interaction: "opened",
        userArticleTS: NOW - 500,
      };

      dynamoDbLib.call
        .mockResolvedValueOnce({ Item: article })
        .mockResolvedValueOnce({ Item: userArticle })
        .mockResolvedValueOnce({}); // update

      const result = await interactionLib.registerOpenedEvent({
        userId: "user-1",
        articleId: "article-1",
      });

      expect(result).toBe("opened timestamp updated");
    });

    it("should update timestamp but not change interaction if vote exists", async () => {
      const article = createFreshArticle({ interestCount: 1 });

      const userArticle = {
        id: "user-1",
        sortKey: "user-article#article-1",
        interaction: "interest",
        userArticleTS: NOW - 500,
      };

      dynamoDbLib.call
        .mockResolvedValueOnce({ Item: article })
        .mockResolvedValueOnce({ Item: userArticle })
        .mockResolvedValueOnce({}); // update

      const result = await interactionLib.registerOpenedEvent({
        userId: "user-1",
        articleId: "article-1",
      });

      expect(result).toBe("opened timestamp updated, vote unchanged");
    });
  });

  describe("registerInterestVoteEvent", () => {
    it("should transition from scrollBy to interest vote", async () => {
      const article = createFreshArticle({ scrollByCount: 1 });

      const userArticle = {
        id: "user-1",
        sortKey: "user-article#article-1",
        interaction: "scrollBy",
        userArticleTS: NOW - 500,
      };

      dynamoDbLib.call
        .mockResolvedValueOnce({ Item: article })
        .mockResolvedValueOnce({ Item: userArticle })
        .mockResolvedValueOnce({}); // transactWrite

      const result = await interactionLib.registerInterestVoteEvent({
        userId: "user-1",
        articleId: "article-1",
        voteType: "interest",
      });

      expect(result).toBe("scrollBy to interest");
    });

    it("should transition from opened to uninterest vote", async () => {
      const article = createFreshArticle({ openedCount: 1 });

      const userArticle = {
        id: "user-1",
        sortKey: "user-article#article-1",
        interaction: "opened",
        userArticleTS: NOW - 500,
      };

      dynamoDbLib.call
        .mockResolvedValueOnce({ Item: article })
        .mockResolvedValueOnce({ Item: userArticle })
        .mockResolvedValueOnce({}); // transactWrite

      const result = await interactionLib.registerInterestVoteEvent({
        userId: "user-1",
        articleId: "article-1",
        voteType: "uninterest",
      });

      expect(result).toBe("opened to uninterest");
    });

    it("should swap from interest to uninterest vote", async () => {
      const article = createFreshArticle({ interestCount: 1 });

      const userArticle = {
        id: "user-1",
        sortKey: "user-article#article-1",
        interaction: "interest",
        userArticleTS: NOW - 500,
      };

      dynamoDbLib.call
        .mockResolvedValueOnce({ Item: article })
        .mockResolvedValueOnce({ Item: userArticle })
        .mockResolvedValueOnce({}); // transactWrite

      const result = await interactionLib.registerInterestVoteEvent({
        userId: "user-1",
        articleId: "article-1",
        voteType: "uninterest",
      });

      expect(result).toBe("interest to uninterest");
    });

    it("should annul vote when recasting same vote", async () => {
      const article = createFreshArticle({ interestCount: 1 });

      const userArticle = {
        id: "user-1",
        sortKey: "user-article#article-1",
        interaction: "interest",
        userArticleTS: NOW - 500,
      };

      dynamoDbLib.call
        .mockResolvedValueOnce({ Item: article })
        .mockResolvedValueOnce({ Item: userArticle })
        .mockResolvedValueOnce({}); // transactWrite

      const result = await interactionLib.registerInterestVoteEvent({
        userId: "user-1",
        articleId: "article-1",
        voteType: "interest",
      });

      expect(result).toBe("interest vote annulled");
    });

    it("should throw error for invalid voteType", async () => {
      await expect(
        interactionLib.registerInterestVoteEvent({
          userId: "user-1",
          articleId: "article-1",
          voteType: "invalid",
        })
      ).rejects.toThrow("voteType must be interest or uninterest");
    });

    it("should create new interaction with interest vote", async () => {
      const article = createFreshArticle();

      dynamoDbLib.call
        .mockResolvedValueOnce({ Item: article })
        .mockResolvedValueOnce({ Item: null })
        .mockResolvedValueOnce({}); // transactWrite

      const result = await interactionLib.registerInterestVoteEvent({
        userId: "user-1",
        articleId: "article-1",
        voteType: "interest",
      });

      expect(result).toBe("none to interest");
    });
  });

  describe("8-day cutoff integration", () => {
    it("should reject operations on articles more than 8 days old", async () => {
      const moreThanEightDaysAgoTS = NOW - (EIGHT_DAYS_SECONDS + 100);
      const article = createFreshArticle({ addedTS: moreThanEightDaysAgoTS });

      dynamoDbLib.call.mockResolvedValueOnce({ Item: article });

      const result = await interactionLib.registerScrollByEvent({
        userId: "user-1",
        articleId: "article-1",
      });

      expect(result).toBe("Old article");
    });

    it("should allow operations on articles slightly under 8 days old", async () => {
      const sevenDayNinetyNineSecondsAgoTS = NOW - (EIGHT_DAYS_SECONDS - 1);
      const article = createFreshArticle({
        addedTS: sevenDayNinetyNineSecondsAgoTS,
      });

      dynamoDbLib.call
        .mockResolvedValueOnce({ Item: article })
        .mockResolvedValueOnce({ Item: null })
        .mockResolvedValueOnce({}); // transactWrite

      const result = await interactionLib.registerScrollByEvent({
        userId: "user-1",
        articleId: "article-1",
      });

      expect(result).toBe("none to scrollBy");
    });
  });
});
