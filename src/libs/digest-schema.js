//
// JSON schema + runtime validation for the Daily Pull Digest payload.
//
// The schema is passed to OpenAI's `response_format: { type: "json_schema" }`. To avoid the model
// mangling long source URLs (and because strict structured outputs can't enforce array length), each
// highlight cites its sources by **article number** — a 1-based index into the numbered list given in
// the prompt. `validateDigest` resolves those numbers back to real `{ title, url }` from the same
// list, so invented/garbled URLs are impossible and validation is forgiving of minor model drift.
//

export const DIGEST_HIGHLIGHT_COUNT = 5;
export const DIGEST_MAX_SOURCES = 3;

export const digestResponseSchema = {
  name: "daily_pull_digest",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      highlights: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            publisher: { type: "string" },
            topic: { type: "string" },
            headline: { type: "string" },
            summary: { type: "string" },
            // 1-based article numbers (from the numbered list in the prompt) this highlight draws from.
            sources: {
              type: "array",
              items: { type: "integer" },
            },
          },
          required: ["publisher", "topic", "headline", "summary", "sources"],
        },
      },
    },
    required: ["highlights"],
  },
};

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function articleTitle(article) {
  if (isNonEmptyString(article.rwTitle)) return article.rwTitle.trim();
  if (isNonEmptyString(article.title)) return article.title.trim();
  return article.id;
}

//
// Validate + clean a parsed digest payload against the numbered `articles` list it was built from.
// Returns the cleaned `highlights` array (1–DIGEST_HIGHLIGHT_COUNT entries, each with resolved
// `{ title, url }` sources), or `null` if nothing usable came back.
//
// Lenient by design: highlights missing required text or with no resolvable source are skipped rather
// than failing the whole digest; more than DIGEST_HIGHLIGHT_COUNT highlights are capped.
//
export function validateDigest(payload, articles) {
  if (!payload || typeof payload !== "object") return null;

  const highlights = payload.highlights;
  if (!Array.isArray(highlights) || highlights.length < 1) return null;

  const list = Array.isArray(articles) ? articles : [];
  const cleaned = [];

  for (const h of highlights.slice(0, DIGEST_HIGHLIGHT_COUNT)) {
    if (!h || typeof h !== "object") continue;
    if (
      !isNonEmptyString(h.publisher) ||
      !isNonEmptyString(h.topic) ||
      !isNonEmptyString(h.headline) ||
      !isNonEmptyString(h.summary)
    ) {
      continue;
    }
    if (!Array.isArray(h.sources)) continue;

    const seen = new Set();
    const sources = [];
    for (const ref of h.sources) {
      const idx = Number(ref);
      if (!Number.isInteger(idx) || idx < 1 || idx > list.length) continue;

      const article = list[idx - 1];
      if (!article || !article.id || seen.has(article.id)) continue;

      seen.add(article.id);
      sources.push({ title: articleTitle(article), url: article.id });
      if (sources.length >= DIGEST_MAX_SOURCES) break;
    }

    if (sources.length < 1) continue;

    cleaned.push({
      publisher: h.publisher.trim(),
      topic: h.topic.trim(),
      headline: h.headline.trim(),
      summary: h.summary.trim(),
      sources,
    });
  }

  return cleaned.length > 0 ? cleaned : null;
}
