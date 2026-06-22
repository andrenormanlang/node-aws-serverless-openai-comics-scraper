//
// Daily Pull Digest — generation, storage, and read.
//
// Owns the whole digest pipeline in the backend: aggregate the last 24h of scroll-feed articles
// (sortKey="articles"), summarize them into exactly 5 highlights via OpenAI (same call shape as
// `rephrase-lib.js`'s `requestSubjectClassification`: raw fetch + json_schema response_format), and
// store one item per day in DynamoDB. The day rolls over at Malmö (Europe/Stockholm) midnight.
//

import fetch from "node-fetch";
import { encode } from "gpt-tokenizer";
import * as dynamoDbLib from "./dynamodb-lib";
import * as defs from "./defs";
import { getGptConfig } from "./gpt-config";
import {
  digestResponseSchema,
  validateDigest,
  DIGEST_HIGHLIGHT_COUNT,
  DIGEST_MAX_SOURCES,
} from "./digest-schema";

const DIGEST_ID = "digest";
const COVERAGE_HOURS = 24;
const MAX_ARTICLES = 40;
const DIGEST_TTL_DAYS = 7;
const MAX_PROMPT_TOKENS = 12000;

// Malmö (Europe/Stockholm) calendar date as YYYY-MM-DD. The sv-SE locale formats as ISO.
// Used by BOTH generation and read so the digest rolls over at Malmö midnight, not UTC midnight.
export function malmoDate(date = new Date()) {
  return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
}

function sourceLabel(rssUrl) {
  try {
    return new URL(rssUrl).hostname.replace(/^www\./, "");
  } catch {
    return rssUrl || "";
  }
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Build a compact, token-bounded article list for the prompt. Prefers the rewritten title/description.
export function buildDigestPrompt(articles, maxTokens = MAX_PROMPT_TOKENS) {
  const lines = [];
  let tokens = 0;

  for (const a of articles) {
    const title = stripHtml(a.rwTitle || a.title || "");
    if (!title || !a.id) continue;

    const desc = stripHtml(a.rwDescription || a.description || "").slice(0, 280);
    const source = sourceLabel(a.rssUrl);
    const line = `- [${source}] ${title}${desc ? ` — ${desc}` : ""}\n  url: ${a.id}`;

    const lineTokens = encode(line).length;
    if (tokens + lineTokens > maxTokens) break;

    tokens += lineTokens;
    lines.push(line);
  }

  return lines.join("\n");
}

function systemPrompt() {
  return (
    `You are a strict JSON generator for a comics-news daily digest. ` +
    `Cluster the day's comics news into exactly ${DIGEST_HIGHLIGHT_COUNT} themed highlights. ` +
    `Each highlight must have: publisher (e.g. DC, Marvel, Image, Indie), topic/theme ` +
    `(e.g. relaunch, movie/TV, creator news), a short factual headline, a 1–2 sentence ` +
    `plain-language summary, and 1–${DIGEST_MAX_SOURCES} sources chosen ONLY from the provided urls. ` +
    `Never invent urls or facts. Consolidate duplicate coverage of the same event into one highlight. ` +
    `Reply only with JSON matching the schema.`
  );
}

async function callOpenAiForDigest({ model, articleList, forceCorrection }) {
  const userContent =
    `Here is the comics news from the last ${COVERAGE_HOURS} hours (newest first):\n\n` +
    `${articleList}\n\n` +
    `Produce exactly ${DIGEST_HIGHLIGHT_COUNT} highlights as specified.` +
    (forceCorrection
      ? ` Your previous answer was invalid: return EXACTLY ${DIGEST_HIGHLIGHT_COUNT} highlights, ` +
        `each with 1–${DIGEST_MAX_SOURCES} sources whose urls are taken from the list above.`
      : "");

  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${defs.OPEN_AI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 1500,
      response_format: {
        type: "json_schema",
        json_schema: digestResponseSchema,
      },
    }),
  });
}

function parseContent(json) {
  const raw = json?.choices?.[0]?.message?.content || "";
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Read today's (Malmö-date) digest item, or null.
export async function getTodaysDigest() {
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: { id: DIGEST_ID, sortKey: malmoDate() },
  };

  try {
    const result = await dynamoDbLib.call("get", params);
    return result && result.Item ? result.Item : null;
  } catch (e) {
    console.error("getTodaysDigest: Error - " + e.message);
    return null;
  }
}

// Generate today's digest (unless it already exists and not forced) and store it.
// Returns the digest item, or null when there is not enough news / generation failed.
export async function generateDigest({ force = false } = {}) {
  const digestDate = malmoDate();

  if (!force) {
    const existing = await getTodaysDigest();
    if (existing) {
      console.log("generateDigest: today's digest already exists, skipping");
      return existing;
    }
  }

  const coverageEndTS = dynamoDbLib.now();
  const coverageStartTS = coverageEndTS - COVERAGE_HOURS * 3600;

  const articles = await dynamoDbLib.fetchRecentArticles({
    sinceTS: coverageStartTS,
    limit: MAX_ARTICLES,
  });

  if (!articles || articles.length === 0) {
    console.log("generateDigest: no recent articles to summarize");
    return null;
  }

  const allowedUrls = new Set(articles.map((a) => a.id).filter(Boolean));
  const articleList = buildDigestPrompt(articles);

  const config = await getGptConfig();
  const model =
    config.gptModelLong || config.gptModelShort || defs.GPT_MODEL_LONG_DEFAULT;

  let highlights = null;
  for (let attempt = 0; attempt < 2 && !highlights; attempt++) {
    try {
      const res = await callOpenAiForDigest({
        model,
        articleList,
        forceCorrection: attempt > 0,
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("generateDigest: OpenAI failed:", res.status, text);
        continue;
      }

      const json = await res.json();
      highlights = validateDigest(parseContent(json), allowedUrls);

      if (!highlights) {
        console.warn(
          `generateDigest: invalid digest payload (attempt ${attempt + 1})`
        );
      }
    } catch (e) {
      console.error("generateDigest: OpenAI error:", e.message);
    }
  }

  if (!highlights) {
    console.error("generateDigest: could not produce a valid digest");
    return null;
  }

  const sourceCount = new Set(articles.map((a) => sourceLabel(a.rssUrl))).size;
  const ttlTS = dynamoDbLib.ttlTS(DIGEST_TTL_DAYS);

  const item = {
    id: DIGEST_ID,
    sortKey: digestDate,
    digestDate,
    coverageStartTS,
    coverageEndTS,
    model,
    articleCount: articles.length,
    sourceCount,
    highlights,
    createdTS: coverageEndTS,
    ttlTS,
    ttlDbg: dynamoDbLib.tsToDbgStr(ttlTS),
  };

  try {
    await dynamoDbLib.call("put", {
      TableName: defs.WN_STR_KEY_TABLE,
      Item: item,
      ReturnValues: "NONE",
    });
  } catch (e) {
    console.error("generateDigest: failed to store digest:", e.message);
    return null;
  }

  return item;
}
