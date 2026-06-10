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

// Helper: create a mock OpenAI response
function mockOpenAIResponse(content) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        choices: [{ message: { content } }],
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
    await rephrase_data_from_openai("Short article text", "content");

    const fetchBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetchBody.model).toBe("gpt-4o-mini");
  });

  test("selects gptModelLong from config when token count exceeds threshold", async () => {
    // Set a very low threshold so any text triggers the long model
    getGptConfig.mockResolvedValue({
      ...defaultConfig,
      gptTokenThreshold: 1, // 1 token threshold — any text will exceed this
    });

    await rephrase_data_from_openai("Some text that exceeds the threshold", "content");

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
    await rephrase_data_from_openai(sameText, "content");
    const firstModel = JSON.parse(fetch.mock.calls[0][1].body).model;

    fetch.mockClear();

    // Low threshold — same text should now exceed it → long model
    getGptConfig.mockResolvedValue({
      ...defaultConfig,
      gptTokenThreshold: 1,
    });
    await rephrase_data_from_openai(sameText, "content");
    const secondModel = JSON.parse(fetch.mock.calls[0][1].body).model;

    expect(firstModel).toBe("gpt-4o-mini");
    expect(secondModel).toBe("gpt-4o");
  });

});
