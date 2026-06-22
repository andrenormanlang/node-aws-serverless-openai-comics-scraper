//
// JSON schema + runtime validation for the Daily Pull Digest payload.
//
// The schema is passed to OpenAI's `response_format: { type: "json_schema" }`. We keep it to the
// constructs structured-output reliably supports (object / array / string + additionalProperties:false
// + required) and enforce the *counts* (exactly 5 highlights, 1–3 sources, urls drawn from the input)
// in `validateDigest`, mirroring how `rephrase-lib.js` validates classification output.
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
            sources: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  url: { type: "string" },
                },
                required: ["title", "url"],
              },
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

//
// Validate + clean a parsed digest payload. Returns the cleaned `highlights` array, or `null` if the
// payload is unusable. Rules: exactly DIGEST_HIGHLIGHT_COUNT highlights; each with non-empty
// publisher/topic/headline/summary; each with 1–DIGEST_MAX_SOURCES sources whose `url` is in
// `allowedUrls` (no invented links). A highlight left with zero valid sources fails the whole digest.
//
export function validateDigest(payload, allowedUrls) {
  if (!payload || typeof payload !== "object") return null;

  const highlights = payload.highlights;
  if (!Array.isArray(highlights) || highlights.length !== DIGEST_HIGHLIGHT_COUNT) {
    return null;
  }

  const allowed =
    allowedUrls instanceof Set ? allowedUrls : new Set(allowedUrls || []);

  const cleaned = [];

  for (const h of highlights) {
    if (!h || typeof h !== "object") return null;
    if (
      !isNonEmptyString(h.publisher) ||
      !isNonEmptyString(h.topic) ||
      !isNonEmptyString(h.headline) ||
      !isNonEmptyString(h.summary)
    ) {
      return null;
    }

    if (!Array.isArray(h.sources)) return null;

    const sources = h.sources
      .filter(
        (s) =>
          s &&
          typeof s.url === "string" &&
          (allowed.size === 0 || allowed.has(s.url))
      )
      .map((s) => ({
        title: isNonEmptyString(s.title) ? s.title.trim() : s.url,
        url: s.url,
      }))
      .slice(0, DIGEST_MAX_SOURCES);

    if (sources.length < 1) return null;

    cleaned.push({
      publisher: h.publisher.trim(),
      topic: h.topic.trim(),
      headline: h.headline.trim(),
      summary: h.summary.trim(),
      sources,
    });
  }

  return cleaned;
}
