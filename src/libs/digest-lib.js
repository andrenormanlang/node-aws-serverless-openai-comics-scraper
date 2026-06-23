//
// Daily Pull Digest — generation, storage, and read.
//
// Owns the whole digest pipeline in the backend: aggregate the last 24h of scroll-feed articles
// (sortKey="articles"), summarize them into up to 5 highlights via OpenAI (same call shape as
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

// Pick the articles that will feed the prompt: those with a usable title + id, token-bounded,
// preserving recency order. The returned order defines the 1-based numbering the model cites by, so
// generation and validation must use this exact list.
export function selectDigestArticles(articles, maxTokens = MAX_PROMPT_TOKENS) {
  const selected = [];
  let tokens = 0;

  for (const a of articles || []) {
    const title = stripHtml(a.rwTitle || a.title || "");
    if (!title || !a.id) continue;

    const desc = stripHtml(a.rwDescription || a.description || "").slice(0, 280);
    const source = sourceLabel(a.rssUrl);
    const line = `[${selected.length + 1}] (${source}) ${title}${desc ? ` — ${desc}` : ""}`;

    const lineTokens = encode(line).length;
    if (tokens + lineTokens > maxTokens) break;

    tokens += lineTokens;
    selected.push({ article: a, line });
  }

  return selected;
}

// Compact, numbered article list for the prompt. (Convenience wrapper around selectDigestArticles.)
export function buildDigestPrompt(articles, maxTokens = MAX_PROMPT_TOKENS) {
  return selectDigestArticles(articles, maxTokens)
    .map((s) => s.line)
    .join("\n");
}

function systemPrompt() {
  return (
    `You are a strict JSON generator for a comics-news daily digest. ` +
    `Cluster the day's comics news into exactly ${DIGEST_HIGHLIGHT_COUNT} themed highlights. ` +
    `Each highlight must have: publisher (e.g. DC, Marvel, Image, Indie), topic/theme ` +
    `(e.g. relaunch, movie/TV, creator news), a short factual headline, a 1–2 sentence ` +
    `plain-language summary, and "sources": an array of 1–${DIGEST_MAX_SOURCES} article NUMBERS ` +
    `(the leading [n] from the list) that the highlight draws from. ` +
    `Use only numbers shown in the list; never invent numbers or facts. ` +
    `Consolidate duplicate coverage of the same event into one highlight. ` +
    `Reply only with JSON matching the schema.`
  );
}

async function callOpenAiForDigest({ model, articleList, forceCorrection }) {
  const userContent =
    `Here is the comics news from the last ${COVERAGE_HOURS} hours (newest first), ` +
    `each line numbered with its [n]:\n\n` +
    `${articleList}\n\n` +
    `Produce exactly ${DIGEST_HIGHLIGHT_COUNT} highlights. ` +
    `For each highlight's "sources", list the 1–${DIGEST_MAX_SOURCES} article numbers it draws from.` +
    (forceCorrection
      ? ` Your previous answer was invalid: return ${DIGEST_HIGHLIGHT_COUNT} highlights, each with at ` +
        `least one valid source number from the list above.`
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
      max_tokens: 2000,
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

  const fetched = await dynamoDbLib.fetchRecentArticles({
    sinceTS: coverageStartTS,
    limit: MAX_ARTICLES,
  });

  const selected = selectDigestArticles(fetched);
  if (selected.length === 0) {
    console.log("generateDigest: no recent articles to summarize");
    return null;
  }

  const articleList = selected.map((s) => s.line).join("\n");
  const promptArticles = selected.map((s) => s.article);

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
      const payload = parseContent(json);
      highlights = validateDigest(payload, promptArticles);

      if (!highlights) {
        const count =
          payload && Array.isArray(payload.highlights)
            ? payload.highlights.length
            : "none";
        console.warn(
          `generateDigest: invalid digest payload (attempt ${attempt + 1}); ` +
            `highlights=${count}, articles=${promptArticles.length}, ` +
            `refusal=${json?.choices?.[0]?.message?.refusal ?? "none"}`
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

  const sourceCount = new Set(promptArticles.map((a) => sourceLabel(a.rssUrl)))
    .size;
  const ttlTS = dynamoDbLib.ttlTS(DIGEST_TTL_DAYS);

  const item = {
    id: DIGEST_ID,
    sortKey: digestDate,
    digestDate,
    coverageStartTS,
    coverageEndTS,
    model,
    articleCount: promptArticles.length,
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
