import { encode } from "gpt-tokenizer"; // Utility to encode and decode text for GPT models
import * as defs from "../libs/defs";
import { getGptConfig } from "../libs/gpt-config";
import fetch from "node-fetch";
import * as dynamoDbLib from "./dynamodb-lib";

const DEFAULT_PROMPTS = {
  title: `
You are given a headline from a comics or pop-culture news article.
Rewrite the headline in clear, natural English.

Rules:
- Keep the same meaning.
- Make it concise and factual.
- No line breaks.
- Max 90 characters.
- Return only the rewritten headline.
`,
  description: `
You are given a short description (lead paragraph) from a comics or pop-culture news article.
Rewrite the description in clear, natural English.

Rules:
- Keep all meaning and factual content.
- Make it clear and informative.
- No line breaks.
- Return only the rewritten description.
`,
  body: `
You are given text scraped from a comics or pop-culture news article. It may contain noise from scraping.

The text may include:
- image captions
- photo credits
- links
- calls to action like "Read more", "Click here", "Subscribe"
- social media references
- navigation or interface text
- duplicated or truncated lines

Your task is to rewrite only the actual article text in correct, natural, and informative English.

Rules:
- Keep all meaning, facts, and details.
- All parts of the article content must be preserved in the rewrite.
- Do not omit any content.
- This is a rewrite, not a summary.
- Do not omit facts, quotes, events, or explanations from the original.
- Quotes must be reproduced verbatim.
- Only remove text that is clearly scraping noise (e.g. image captions, photo credits, links, CTAs).
- After removing scraping noise, the text length should not vary by more than approximately 20% compared to the original body text.
- Write in neutral news language.
- Divide the text into clear paragraphs.
- Add a blank line between paragraphs.
- Merge incorrect line breaks in the middle of sentences.
- Return only the rewritten article text.
`,
};

function removeBackticks(str) {
  if (str.startsWith("`") && str.endsWith("`")) {
    return str.slice(1, -1);
  }
  return str;
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
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text();
      console.error("OpenAI rephrase failed:", res.status, key, bodyText);
      return "";
    }

    const chatCompletion = await res.json();
    const rawContent = chatCompletion.choices?.[0]?.message?.content;

    const result =
      key === "title" ? removeBackticks(rawContent || "") : rawContent || "";

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
