import { classify_subject_from_openai } from "../src/libs/rephrase-lib";
import { getGptConfig } from "../src/libs/gpt-config";
import * as dynamoDbLib from "../src/libs/dynamodb-lib";
import fetch from "node-fetch";

// Mock dependencies
jest.mock("../src/libs/gpt-config");
jest.mock("../src/libs/dynamodb-lib");
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

const defaultConfig = {
  gptModelTitle: "gpt-4o-mini",
  gptModelShort: "gpt-short",
  gptModelLong: "gpt-long",
  gptTokenThreshold: 6000,
};

function mockOpenAIResponse(content, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => String(content),
  };
}

beforeEach(() => {
  getGptConfig.mockReset();
  dynamoDbLib.call.mockReset();
  fetch.mockReset();

  getGptConfig.mockResolvedValue(defaultConfig);
});

test("uses all subjects present in the DynamoDB subjects item", async () => {
  dynamoDbLib.call.mockResolvedValue({
    Item: { subjects: [{ id: 1, Name: "X", toShow: 0 }] },
  });
  fetch.mockResolvedValue(mockOpenAIResponse("1"));

  const result = await classify_subject_from_openai("Some article about X", 0.1);

  expect(result).toBe(1);
  expect(fetch).toHaveBeenCalled();
});

test("returns numeric id when OpenAI returns a valid candidate id", async () => {
  const subjects = [
    { id: 57, Name: "Nato", toShow: 1 },
    { id: 100, Name: "Other", toShow: 2 },
    { id: 3, Name: "Hidden", toShow: 0 },
  ];
  dynamoDbLib.call.mockResolvedValue({ Item: { subjects } });

  fetch.mockResolvedValue(mockOpenAIResponse("57"));

  const result = await classify_subject_from_openai(
    "Article about Nato and defence",
    0.1
  );

  expect(result).toBe(57);

  // Verify OpenAI was called with temperature and that topics list is included
  expect(fetch).toHaveBeenCalled();
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.model).toBe("gpt-short");
  expect(body.temperature).toBeCloseTo(0.1);
  expect(body.response_format.type).toBe("json_schema");
  expect(body.messages[1].content).toMatch(/57:\s*Nato/);
  expect(body.messages[1].content).toMatch(/100:\s*Other/);
});

test("returns numeric id when OpenAI returns structured JSON", async () => {
  const subjects = [
    { id: 57, Name: "Nato", toShow: 1 },
    { id: 100, Name: "Other", toShow: 2 },
  ];
  dynamoDbLib.call.mockResolvedValue({ Item: { subjects } });

  fetch.mockResolvedValue(
    mockOpenAIResponse(
      JSON.stringify({
        subject_id: 57,
        confidence: 0.91,
        reason: "Article is mainly about Nato.",
      })
    )
  );

  const result = await classify_subject_from_openai(
    "Article about Nato and defence",
    0.1
  );

  expect(result).toBe(57);
});

test("forces a best candidate when the first model response chooses zero", async () => {
  const subjects = [
    { id: 57, Name: "Nato", toShow: 1 },
    { id: 100, Name: "Other", toShow: 2 },
  ];
  dynamoDbLib.call.mockResolvedValue({ Item: { subjects } });

  fetch
    .mockResolvedValueOnce(
      mockOpenAIResponse(
        JSON.stringify({
          subject_id: 0,
          confidence: 0.2,
          reason: "No exact match.",
        })
      )
    )
    .mockResolvedValueOnce(
      mockOpenAIResponse(
        JSON.stringify({
          subject_id: 57,
          confidence: 0.6,
          reason: "Closest available subject.",
        })
      )
    );

  const result = await classify_subject_from_openai(
    "Article about a defence alliance",
    0.1
  );

  expect(result).toBe(57);
  expect(fetch).toHaveBeenCalledTimes(2);
  const retryBody = JSON.parse(fetch.mock.calls[1][1].body);
  expect(retryBody.messages[1].content).toMatch(/Returnera aldrig 0/);
});

test("uses a local keyword fallback when OpenAI classification fails", async () => {
  const subjects = [
    { id: 57, Name: "Nato", toShow: 1 },
    { id: 100, Name: "Other", toShow: 2 },
  ];
  dynamoDbLib.call.mockResolvedValue({ Item: { subjects } });

  fetch.mockResolvedValue(mockOpenAIResponse("server error", false));

  const result = await classify_subject_from_openai(
    "Sverige och Nato diskuterar forsvarsalliansen.",
    0.1
  );

  expect(result).toBe(57);
});

test("supports DynamoDB typed-map subjects list and falls back when toShow is missing", async () => {
  const subjects = [
    { M: { id: { N: "57" }, Name: { S: "Nato" } } },
    { M: { id: { N: "88" }, Name: { S: "Yttrandefrihet" } } },
  ];
  dynamoDbLib.call.mockResolvedValue({ Item: { subjects } });

  fetch.mockResolvedValue(mockOpenAIResponse("57"));

  const result = await classify_subject_from_openai("Article about Nato", 0.1);

  expect(result).toBe(57);
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.model).toBe("gpt-short");
  expect(body.messages[1].content).toMatch(/57:\s*Nato/);
  expect(body.messages[1].content).toMatch(/88:\s*Yttrandefrihet/);
});

test("returns 0 when OpenAI suggests an id not present in candidates", async () => {
  dynamoDbLib.call.mockResolvedValue({
    Item: { subjects: [{ id: 5, Name: "Alpha", toShow: 1 }] },
  });
  fetch.mockResolvedValue(mockOpenAIResponse("999"));

  const result = await classify_subject_from_openai("Unrelated article", 0.1);
  expect(result).toBe(0);
});

test("returns 0 when OpenAI returns non-numeric content", async () => {
  dynamoDbLib.call.mockResolvedValue({
    Item: { subjects: [{ id: 8, Name: "Beta", toShow: 2 }] },
  });
  fetch.mockResolvedValue(mockOpenAIResponse("I think none of these fit"));

  const result = await classify_subject_from_openai(
    "Another article text",
    0.1
  );
  expect(result).toBe(0);
});
