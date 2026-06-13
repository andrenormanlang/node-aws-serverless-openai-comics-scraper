import { rephrase_data_from_openai } from "../src/libs/rephrase-lib";
import { getGptConfig } from "../src/libs/gpt-config";
import fetch from "node-fetch";

// Mock dependencies
jest.mock("../src/libs/gpt-config");
jest.mock("node-fetch");

// Suppress console output during tests
beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

// Helper: create a mock OpenAI response.
// finishReason defaults to "stop" (a normal, complete generation) so existing
// model-selection tests are unaffected. Pass "length" to simulate truncation.
function mockOpenAIResponse(content, finishReason = "stop") {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        choices: [{ message: { content }, finish_reason: finishReason }],
      }),
    text: async () => String(content),
  };
}

// Default config used in all tests (unless overridden)
const defaultConfig = {
  gptModelTitle: "gpt-4o-mini",
  gptModelShort: "gpt-4o-mini",
  gptModelLong: "gpt-4o",
  gptTokenThreshold: 6000,
};

beforeEach(() => {
  getGptConfig.mockReset();
  fetch.mockReset();
  getGptConfig.mockResolvedValue(defaultConfig);
  fetch.mockResolvedValue(mockOpenAIResponse("rephrased text"));
});

describe("rephrase_data_from_openai – config-driven model selection", () => {
  test("selects gptModelTitle from config when key is 'title'", async () => {
    getGptConfig.mockResolvedValue({
      ...defaultConfig,
      gptModelTitle: "custom-title-model",
    });

    await rephrase_data_from_openai("A short headline", "title");

    const fetchBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetchBody.model).toBe("custom-title-model");
  });

  test("selects gptModelShort from config when token count is below threshold", async () => {
    // Short text — well under 6000 tokens
    await rephrase_data_from_openai("Short article text", "body");

    const fetchBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetchBody.model).toBe("gpt-4o-mini");
  });

  test("selects gptModelLong from config when token count exceeds threshold", async () => {
    // Set a very low threshold so any text triggers the long model
    getGptConfig.mockResolvedValue({
      ...defaultConfig,
      gptTokenThreshold: 1, // 1 token threshold — any text will exceed this
    });

    await rephrase_data_from_openai("Some text that exceeds the threshold", "body");

    const fetchBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetchBody.model).toBe("gpt-4o");
  });

  test("gptTokenThreshold from config determines short vs long model for identical text", async () => {
    const sameText = "This is a test sentence to verify threshold behavior";

    // High threshold — text should be under it → short model
    getGptConfig.mockResolvedValue({
      ...defaultConfig,
      gptTokenThreshold: 99999,
    });
    await rephrase_data_from_openai(sameText, "body");
    const firstModel = JSON.parse(fetch.mock.calls[0][1].body).model;

    fetch.mockClear();

    // Low threshold — same text should now exceed it → long model
    getGptConfig.mockResolvedValue({
      ...defaultConfig,
      gptTokenThreshold: 1,
    });
    await rephrase_data_from_openai(sameText, "body");
    const secondModel = JSON.parse(fetch.mock.calls[0][1].body).model;

    expect(firstModel).toBe("gpt-4o-mini");
    expect(secondModel).toBe("gpt-4o");
  });
});

describe("rephrase_data_from_openai – request params and truncation", () => {
  test("sends low temperature and a max_tokens cap for body rewrites", async () => {
    await rephrase_data_from_openai("Some article body text", "body");

    const fetchBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetchBody.temperature).toBe(0.3);
    expect(fetchBody.max_tokens).toBeGreaterThan(0);
  });

  test("sends low temperature for title and description rewrites", async () => {
    await rephrase_data_from_openai("A headline", "title");
    expect(JSON.parse(fetch.mock.calls[0][1].body).temperature).toBe(0.3);

    fetch.mockClear();

    await rephrase_data_from_openai("A lead paragraph", "description");
    expect(JSON.parse(fetch.mock.calls[0][1].body).temperature).toBe(0.3);
  });

  test("returns empty string when body rewrite is truncated (finish_reason=length)", async () => {
    fetch.mockResolvedValue(
      mockOpenAIResponse("partial body that got cut off", "length")
    );

    const result = await rephrase_data_from_openai("long body", "body");

    // Truncated body is treated as a failure so the caller records rwError
    // instead of persisting a half-written article.
    expect(result).toBe("");
  });

  test("does NOT discard a truncated title (only body is treated as failure)", async () => {
    fetch.mockResolvedValue(mockOpenAIResponse("a title", "length"));

    const result = await rephrase_data_from_openai("headline", "title");

    // Title truncation is logged but the (short) result is still returned.
    expect(result).not.toBe("");
  });

  test("returns the body unchanged when generation completes normally", async () => {
    fetch.mockResolvedValue(
      mockOpenAIResponse("A complete rewritten body.", "stop")
    );

    const result = await rephrase_data_from_openai("body in", "body");
    expect(result).toBe("A complete rewritten body.");
  });
});

describe("rephrase_data_from_openai – output cleanup", () => {
  test("strips a leading preamble from body output", async () => {
    fetch.mockResolvedValue(
      mockOpenAIResponse("Here is the rewritten article:\n\nReal body text.")
    );

    const result = await rephrase_data_from_openai("body in", "body");
    expect(result).toBe("Real body text.");
  });

  test("strips surrounding markdown code fences from body output", async () => {
    fetch.mockResolvedValue(
      mockOpenAIResponse("```\nFenced body content.\n```")
    );

    const result = await rephrase_data_from_openai("body in", "body");
    expect(result).toBe("Fenced body content.");
  });

  test("leaves clean body output untouched", async () => {
    fetch.mockResolvedValue(
      mockOpenAIResponse("Plain body with no preamble or fences.")
    );

    const result = await rephrase_data_from_openai("body in", "body");
    expect(result).toBe("Plain body with no preamble or fences.");
  });

  test("removes wrapping backticks from title output", async () => {
    fetch.mockResolvedValue(mockOpenAIResponse("`A backticked title`"));

    const result = await rephrase_data_from_openai("headline", "title");
    expect(result).toBe("A backticked title");
  });
});

describe("rephrase_data_from_openai – edge cases", () => {
  test("returns empty string for empty input without calling the API", async () => {
    const result = await rephrase_data_from_openai("", "body");
    expect(result).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("returns empty string when the API responds non-OK", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal error",
    });

    const result = await rephrase_data_from_openai("some body", "body");
    expect(result).toBe("");
  });
});