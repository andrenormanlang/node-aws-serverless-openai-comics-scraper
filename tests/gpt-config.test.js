import { getGptConfig, clearConfigCache } from "../src/libs/gpt-config";
import * as dynamoDbLib from "../src/libs/dynamodb-lib";
import * as defs from "../src/libs/defs";

// Mock the DynamoDB library
jest.mock("../src/libs/dynamodb-lib");

// Suppress console.log/error during tests
beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

beforeEach(() => {
  clearConfigCache();
  dynamoDbLib.call.mockReset();
});

describe("getGptConfig", () => {
  test("returns defaults when DynamoDB has no config record", async () => {
    dynamoDbLib.call.mockResolvedValue({ Item: undefined });

    const config = await getGptConfig();

    expect(config).toEqual({
      gptModelTitle: defs.GPT_MODEL_TITLE_DEFAULT,
      gptModelShort: defs.GPT_MODEL_SHORT_DEFAULT,
      gptModelLong: defs.GPT_MODEL_LONG_DEFAULT,
      gptTokenThreshold: defs.GPT_TOKEN_THRESHOLD_DEFAULT,
      rewritePromptTitle: "",
      rewritePromptDescription: "",
      rewritePromptBody: "",
    });
  });

  test("uses DynamoDB values when they exist", async () => {
    dynamoDbLib.call.mockResolvedValue({
      Item: {
        gptModelTitle: "gpt-4o",
        gptModelShort: "gpt-4o",
        gptModelLong: "gpt-4-turbo",
        gptTokenThreshold: 4000,
        rewritePromptTitle: "title prompt from db",
        rewritePromptDescription: "description prompt from db",
        rewritePromptBody: "body prompt from db",
      },
    });

    const config = await getGptConfig();

    expect(config).toEqual({
      gptModelTitle: "gpt-4o",
      gptModelShort: "gpt-4o",
      gptModelLong: "gpt-4-turbo",
      gptTokenThreshold: 4000,
      rewritePromptTitle: "title prompt from db",
      rewritePromptDescription: "description prompt from db",
      rewritePromptBody: "body prompt from db",
    });
  });

  test("partial DynamoDB override — missing fields fall back to defaults, string threshold is converted to number", async () => {
    dynamoDbLib.call.mockResolvedValue({
      Item: {
        gptModelTitle: "gpt-4o",
        gptTokenThreshold: "8000",
        // gptModelShort, gptModelLong are missing
      },
    });

    const config = await getGptConfig();

    expect(config.gptModelTitle).toBe("gpt-4o");
    expect(config.gptModelShort).toBe(defs.GPT_MODEL_SHORT_DEFAULT);
    expect(config.gptModelLong).toBe(defs.GPT_MODEL_LONG_DEFAULT);
    expect(config.gptTokenThreshold).toBe(8000);
    expect(config.rewritePromptTitle).toBe("");
    expect(config.rewritePromptDescription).toBe("");
    expect(config.rewritePromptBody).toBe("");
    expect(typeof config.gptTokenThreshold).toBe("number");
  });

  test("cache hit — second call within TTL does not query DynamoDB again", async () => {
    dynamoDbLib.call.mockResolvedValue({ Item: undefined });

    await getGptConfig();
    await getGptConfig();

    expect(dynamoDbLib.call).toHaveBeenCalledTimes(1);
  });

  test("cache expiry — new DB read after TTL passes", async () => {
    dynamoDbLib.call.mockResolvedValue({ Item: undefined });

    const realDateNow = Date.now;
    let fakeTime = 1000000;
    Date.now = () => fakeTime;

    try {
      await getGptConfig(); // first call — fetches from DB
      expect(dynamoDbLib.call).toHaveBeenCalledTimes(1);

      // Advance time past the 5-minute TTL
      fakeTime += 5 * 60 * 1000 + 1;

      await getGptConfig(); // should fetch again
      expect(dynamoDbLib.call).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = realDateNow;
    }
  });

  test("DynamoDB error — falls back to defaults without throwing", async () => {
    dynamoDbLib.call.mockRejectedValue(new Error("DynamoDB timeout"));

    const config = await getGptConfig();

    expect(config).toEqual({
      gptModelTitle: defs.GPT_MODEL_TITLE_DEFAULT,
      gptModelShort: defs.GPT_MODEL_SHORT_DEFAULT,
      gptModelLong: defs.GPT_MODEL_LONG_DEFAULT,
      gptTokenThreshold: defs.GPT_TOKEN_THRESHOLD_DEFAULT,
      rewritePromptTitle: "",
      rewritePromptDescription: "",
      rewritePromptBody: "",
    });
  });
});
