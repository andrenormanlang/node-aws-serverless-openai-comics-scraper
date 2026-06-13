import { encode } from "gpt-tokenizer"; // Utility to encode and decode text for GPT models
import * as defs from "../libs/defs";
import { getGptConfig } from "../libs/gpt-config";
import fetch from "node-fetch";
import * as dynamoDbLib from "./dynamodb-lib";

const DEFAULT_PROMPTS = {
  title: `
You rewrite headlines from comics and pop-culture news articles into clear, natural English.

Rules:
- Preserve the exact meaning. Do not add information not present in the original.
- Keep all proper nouns (character names, titles, creators, publishers) exactly as written.
- Concise and factual; no clickbait, no editorializing.
- One line, no line breaks. Max 90 characters.
- Output only the rewritten headline, with no quotation marks, labels, or preamble.
`,
  description: `
You rewrite the lead paragraph of a comics or pop-culture news article into clear, natural English.

Rules:
- Preserve all factual content: names, titles, dates, numbers, and events.
- Do not add, infer, or invent any information.
- Keep all proper nouns exactly as written.
- One paragraph, no line breaks.
- Neutral news register.
- Output only the rewritten description, with no labels or preamble.
`,
  body: `
You rewrite the body of a comics or pop-culture news article into clear, natural, fluent English. The input is scraped HTML text and may contain leftover noise.

This is a REWRITE, not a summary. Your job is to restate the same article in cleaner prose, preserving everything of substance.

PRESERVE (must not be lost):
- Every fact, name, title, date, number, and event in the source.
- All direct quotations, reproduced word-for-word inside quotation marks. Never paraphrase text that appears inside quotes.
- The original ordering and logical flow of the article.
- The original language of the article (if the source is in another language, rewrite in that same language).

REMOVE (scraping noise only):
- Image captions, photo/illustration credits.
- Inline links, bare URLs, "Read more / Click here / Subscribe / Tip us" calls to action.
- Social-media prompts, share buttons, navigation labels, menu text, advertisement markers.
- Duplicated lines and fragments left over from scraping.

DO NOT:
- Do not summarize, shorten, or compress the actual reporting.
- Do not omit facts, quotes, events, or explanations.
- Do not add commentary, opinions, or information not in the source.
- Do not add a headline, byline, or concluding remark of your own.

FORMAT:
- Group sentences into coherent paragraphs.
- Separate paragraphs with a single blank line.
- Merge broken mid-sentence line breaks from the scrape into continuous sentences.

Output ONLY the rewritten article text. Do not include any preamble such as "Here is the rewritten article" or any labels, headers, or markdown fences.
`,
};

// Body/description rewrites are faithfulness tasks: keep temperature low so the
// model restates rather than reinterprets. Title is also low for consistency.
const REWRITE_TEMPERATURE = {
  title: 0.3,
  description: 0.3,
  body: 0.3,
};

// Generous output ceiling so long articles are not silently truncated.
// finish_reason is checked separately to detect when this is still hit.
const REWRITE_MAX_TOKENS = {
  title: 120,
  description: 400,
  body: 4000,
};

function removeBackticks(str) {
  if (str.startsWith("`") && str.endsWith("`")) {
    return str.slice(1, -1);
  }
  return str;
}

// Defensive: strip a leading "Here is the rewritten ...:" style preamble and any
// stray markdown code fences the model may add despite instructions.
function stripPreambleAndFences(str) {
  if (!str) return str;
  let out = str.trim();

  // Remove surrounding ``` or ```lang fences.
  const fenceMatch = out.match(/^```[a-z]*\s*\n([\s\S]*?)\n```$/i);
  if (fenceMatch) {
    out = fenceMatch[1].trim();
  }

  // Remove a single leading preamble line like "Here is the rewritten article:"
  out = out.replace(
    /^(here(?:'s| is)[^\n:]*:|rewritten (?:article|text|version)[^\n:]*:)\s*\n+/i,
    ""
  );

  return out.trim();
}

function getRuntimePrompt(key, config) {
  if (key === "title") {
    return (config?.rewritePromptTitle || DEFAULT_PROMPTS.title).trim();
  }

  if (key === "description") {
    return (
      config?.rewritePromptDescription || DEFAULT_PROMPTS.description
    ).trim();
  }

  return (config?.rewritePromptBody || DEFAULT_PROMPTS.body).trim();
}

function extractString(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.S === "string") return value.S;
  return "";
}

function extractNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (value && typeof value.N === "string") {
    const parsed = Number(value.N);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeSubjectEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  const raw = entry.M && typeof entry.M === "object" ? entry.M : entry;
  const id = extractNumber(raw.id);
  const name = extractString(raw.Name);
  const toShow = extractNumber(raw.toShow);

  if (!Number.isFinite(id) || !name) return null;

  return {
    id: Number(id),
    Name: name,
    toShow: toShow === null ? null : Number(toShow),
  };
}

const SUBJECT_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "are",
  "was",
  "has",
  "new",
  "more",
  "about",
  "comics",
  "comic",
]);

const SUBJECT_KEYWORD_OVERRIDES = {};

function normalizeForSubjectMatching(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasNormalizedPhrase(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(text);
}

function subjectTerms(subject) {
  const baseTerms = normalizeForSubjectMatching(subject.Name)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !SUBJECT_STOP_WORDS.has(term));

  const overrideTerms = SUBJECT_KEYWORD_OVERRIDES[Number(subject.id)] || [];
  return [
    ...new Set([...baseTerms, ...overrideTerms.map(normalizeForSubjectMatching)]),
  ];
}

function findLocalSubjectFallback(articleText, candidates, minimumScore = 4) {
  const normalizedText = normalizeForSubjectMatching(articleText);
  if (!normalizedText) return 0;

  let best = { id: 0, score: 0, name: "" };

  for (const candidate of candidates) {
    let score = 0;
    const normalizedName = normalizeForSubjectMatching(candidate.Name);

    if (normalizedName && hasNormalizedPhrase(normalizedText, normalizedName)) {
      score += 12;
    }

    for (const term of subjectTerms(candidate)) {
      if (!term) continue;
      if (hasNormalizedPhrase(normalizedText, term)) {
        score += term.includes(" ") ? 5 : 2;
      }
    }

    if (score > best.score) {
      best = { id: Number(candidate.id), score, name: candidate.Name };
    }
  }

  if (best.score >= minimumScore) {
    console.log("AI subject classification local fallback", best);
    return best.id;
  }

  return 0;
}

function parseSubjectClassification(raw) {
  const trimmed = String(raw || "").trim();

  if (!trimmed) {
    return { chosen: 0, confidence: 0, reason: "" };
  }

  try {
    const parsed = JSON.parse(trimmed);
    const subjectId = extractNumber(
      parsed.subject_id ?? parsed.subjectId ?? parsed.id
    );
    return {
      chosen: Number.isFinite(subjectId) ? Number(subjectId) : 0,
      confidence: extractNumber(parsed.confidence) ?? null,
      reason: extractString(parsed.reason),
    };
  } catch {
    const m = trimmed.match(/-?\d+/);
    return {
      chosen: m ? parseInt(m[0], 10) : 0,
      confidence: null,
      reason: "",
    };
  }
}

async function requestSubjectClassification({
  model,
  articleText,
  topicsText,
  temperature,
  forceChoice = false,
}) {
  const userContent = `Here is a comics or pop-culture news article:\n\n${articleText}\n\nSubjects to choose from:\n${topicsText}\n\nInstruction: Choose the subject that best matches the article's main content. ${
    forceChoice
      ? "You must choose one of the subject IDs in the list. Never return 0."
      : "Always choose the closest subject if the text is understandable. Return 0 only if the article text is empty, broken, or completely impossible to classify."
  } Return JSON with subject_id, confidence and reason.`;

  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${defs.OPEN_AI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You match comics and pop-culture news articles to existing subjects. Reply only with valid JSON according to the schema.",
        },
        { role: "user", content: userContent },
      ],
      temperature,
      max_tokens: 120,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "subject_classification",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              subject_id: { type: "integer" },
              confidence: { type: "number" },
              reason: { type: "string" },
            },
            required: ["subject_id", "confidence", "reason"],
          },
        },
      },
    }),
  });
}

// Function to rephrase data using OpenAI
// Prompts avoid model-change issues by giving clear instructions (system + user).
export async function rephrase_data_from_openai(data, key) {
  if (!data) {
    return "";
  }

  // Get configurable model and prompt settings (DynamoDB runtime override -> env/code defaults)
  const config = await getGptConfig();
  const runtimePrompt = getRuntimePrompt(key, config);

  const messagesGpt = [
    {
      role: "system",
      content: runtimePrompt,
    },
    {
      role: "user",
      content: key === "title" ? removeBackticks(data ?? "") : data,
    },
  ];

  const encoded = encode(data);

  const modelGpt =
    key === "title"
      ? config.gptModelTitle
      : encoded.length < config.gptTokenThreshold
      ? config.gptModelShort
      : config.gptModelLong;

  console.log(
    `rephrase: Using model ${modelGpt} for ${key} (${encoded.length} tokens)`
  );

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${defs.OPEN_AI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelGpt,
        messages: messagesGpt,
        temperature: REWRITE_TEMPERATURE[key] ?? 0.3,
        max_tokens: REWRITE_MAX_TOKENS[key] ?? 4000,
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text();
      console.error("OpenAI rephrase failed:", res.status, key, bodyText);
      return "";
    }

    const chatCompletion = await res.json();
    const choice = chatCompletion.choices?.[0];
    const rawContent = choice?.message?.content;

    // Detect silent truncation: if the model hit the token cap, the stored body
    // would be a partial article presented as complete. Log loudly so it is
    // visible, and (for body) treat it as a failure rather than saving a stub.
    const finishReason = choice?.finish_reason;
    if (finishReason === "length") {
      console.error(
        `OpenAI rephrase truncated (finish_reason=length) for ${key}; ` +
          `input tokens=${encoded.length}, cap=${
            REWRITE_MAX_TOKENS[key] ?? 4000
          }`
      );
      if (key === "body") {
        // Returning "" lets the caller record an rwError instead of a half body.
        return "";
      }
    }

    let result = key === "title" ? removeBackticks(rawContent || "") : rawContent || "";

    // Defensive cleanup of preamble / code fences for the longer-form outputs.
    if (key !== "title") {
      result = stripPreambleAndFences(result);
    }

    return result;
  } catch (error) {
    console.error("OpenAI rephrase error:", key, error);
    return "";
  }
}

// Classify which subject best fits an article using OpenAI.
// Returns the subject `id` (integer) from the stored subjects list or 0 if none fits.
export async function classify_subject_from_openai(
  articleText,
  temperature = 0.1
) {
  if (!articleText || typeof articleText !== "string") return 0;

  try {
    const config = await getGptConfig();

    // Load subjects from DynamoDB (same storage the backend uses)
    const params = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: { id: "subjects", sortKey: "article" },
    };
    const res = await dynamoDbLib.call("get", params);
    const rawSubjects = (res && res.Item && res.Item.subjects) || [];
    const normalizedSubjects = rawSubjects
      .map(normalizeSubjectEntry)
      .filter(Boolean);

    if (!normalizedSubjects.length) {
      console.log("AI subject classification returned 0", {
        reason: "no_normalized_subjects",
        rawSubjectCount: rawSubjects.length,
      });
      return 0;
    }

    // The classifier must only choose from the subjects stored in DynamoDB at
    // id="subjects" / sortKey="article". Do not use app constants or static
    // lists as the candidate source.
    const candidates = normalizedSubjects;

    if (!candidates.length) {
      console.log("AI subject classification returned 0", {
        reason: "no_candidate_subjects",
        normalizedSubjectCount: normalizedSubjects.length,
      });
      return 0;
    }

    // Build topic list lines like: "57: Nato"
    const topicsText = candidates.map((s) => `${s.id}: ${s.Name}`).join("\n");

    // Classification is a simple task; pin to short model to keep cost down.
    const modelGpt =
      config.gptModelShort || config.gptModelLong || config.gptModelTitle;

    let openAiRes = await requestSubjectClassification({
      model: modelGpt,
      articleText,
      topicsText,
      temperature,
    });

    if (!openAiRes.ok) {
      const txt = await openAiRes.text();
      console.error("OpenAI classify failed:", openAiRes.status, txt);
      const localFallback = findLocalSubjectFallback(articleText, candidates);
      if (localFallback > 0) return localFallback;
      return 0;
    }

    const json = await openAiRes.json();
    const raw =
      (json.choices &&
        json.choices[0] &&
        json.choices[0].message &&
        json.choices[0].message.content) ||
      "";
    let { chosen, confidence, reason } = parseSubjectClassification(raw);

    if (!Number.isFinite(chosen)) {
      console.log("AI subject classification returned 0", {
        reason: "non_numeric_model_output",
        raw,
        candidateCount: candidates.length,
      });
      const localFallback = findLocalSubjectFallback(articleText, candidates);
      if (localFallback > 0) return localFallback;
      chosen = 0;
    }

    console.log("AI subject classification raw result", {
      raw,
      chosen,
      confidence,
      reason,
      candidateCount: candidates.length,
    });

    if (
      chosen > 0 &&
      candidates.some((c) => Number(c.id) === Number(chosen))
    ) {
      return chosen;
    }

    const localFallback = findLocalSubjectFallback(articleText, candidates);
    if (localFallback > 0) return localFallback;

    if (chosen === 0) {
      console.log("AI subject classification returned 0", {
        reason: "model_chose_zero",
        raw,
        candidateCount: candidates.length,
      });
    } else {
      console.log("AI subject classification returned 0", {
        reason: "chosen_id_not_in_candidates",
        raw,
        chosen,
        candidateCount: candidates.length,
      });
    }

    // Last attempt: if the first answer was 0/invalid, ask for the closest
    // candidate with 0 disallowed. This increases coverage while keeping the
    // no-candidate/no-text cases as true 0 returns.
    openAiRes = await requestSubjectClassification({
      model: modelGpt,
      articleText,
      topicsText,
      temperature: Math.min(temperature, 0.1),
      forceChoice: true,
    });

    if (!openAiRes.ok) {
      const txt = await openAiRes.text();
      console.error("OpenAI forced classify failed:", openAiRes.status, txt);
      return 0;
    }

    const retryJson = await openAiRes.json();
    const retryRaw =
      retryJson.choices?.[0]?.message?.content ||
      "";
    const retryParsed = parseSubjectClassification(retryRaw);

    console.log("AI subject classification forced result", {
      raw: retryRaw,
      chosen: retryParsed.chosen,
      confidence: retryParsed.confidence,
      reason: retryParsed.reason,
      candidateCount: candidates.length,
    });

    if (
      retryParsed.chosen > 0 &&
      candidates.some((c) => Number(c.id) === Number(retryParsed.chosen))
    ) {
      return retryParsed.chosen;
    }

    return 0;
  } catch (e) {
    console.error("classify_subject_from_openai error:", e);
    return 0;
  }
}