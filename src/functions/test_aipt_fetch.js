import fetch from "node-fetch";

// A few real aiptcomics article URLs pulled from your logs
const TEST_URLS = [
  "https://aiptcomics.com/2026/06/11/marvel-zombies-war-zone/",
  "https://aiptcomics.com/2026/06/12/the-horror-of-godzilla-1-review/",
  "https://aiptcomics.com/2026/06/12/dc-preview-nightwing-139/",
];

// Variant A: your current headers (with br)
const HEADERS_CURRENT = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
};

// Variant B: br dropped + Sec-Fetch client hints added
const HEADERS_ENHANCED = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

async function tryFetch(url, headers, label) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  const started = Date.now();

  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    const elapsed = Date.now() - started;

    // Read a slice of the body so we can tell "real article" from "challenge page"
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch (e) {
      bodyText = `<<failed to read body: ${e.message}>>`;
    }

    const lower = bodyText.toLowerCase();
    const looksLikeCloudflare =
      lower.includes("cloudflare") ||
      lower.includes("cf-ray") ||
      lower.includes("just a moment") ||
      lower.includes("attention required") ||
      lower.includes("checking your browser");
    const looksLikeArticle =
      lower.includes("entry-content") ||
      lower.includes("<article") ||
      lower.includes('itemprop="articlebody"');

    return {
      label,
      url,
      ok: response.ok,
      status: response.status,
      elapsedMs: elapsed,
      contentType: response.headers.get("content-type"),
      contentEncoding: response.headers.get("content-encoding"),
      server: response.headers.get("server"),
      cfRay: response.headers.get("cf-ray"),
      cfMitigated: response.headers.get("cf-mitigated"),
      bodyLength: bodyText.length,
      looksLikeCloudflare,
      looksLikeArticle,
      bodySnippet: bodyText.slice(0, 300).replace(/\s+/g, " "),
    };
  } catch (e) {
    return {
      label,
      url,
      ok: false,
      error: e.name === "AbortError" ? "TIMEOUT (20s)" : e.message,
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function main() {
  const results = [];

  for (const url of TEST_URLS) {
    results.push(await tryFetch(url, HEADERS_CURRENT, "current-headers"));
    results.push(await tryFetch(url, HEADERS_ENHANCED, "enhanced-headers"));
  }

  // Log each result so it shows up in CloudWatch even if the response is truncated
  for (const r of results) {
    console.log(JSON.stringify(r, null, 2));
  }

  // Quick summary line you can grep for
  const summary = results.map(
    (r) => `${r.label} ${r.status ?? r.error} (cf=${r.looksLikeCloudflare ?? "?"})`
  );
  console.log("SUMMARY:", JSON.stringify(summary));

  return { statusCode: 200, body: { results } };
}