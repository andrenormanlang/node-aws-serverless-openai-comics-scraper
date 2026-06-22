import { getTodaysDigest, generateDigest } from "../libs/digest-lib";
import { success } from "../libs/response-lib";

// GET /news/digest — return today's Daily Pull Digest, lazily generating it once if missing.
// Always non-blocking: any failure resolves to `{ digest: null }` so the news page still renders.
export async function main() {
  try {
    let digest = await getTodaysDigest();

    if (!digest) {
      // Lazy catch-up (at most one extra generation/day; generateDigest re-checks existence).
      digest = await generateDigest({ force: false });
    }

    return success({ status: true, digest: digest || null });
  } catch (e) {
    console.error("digest handler error:", e.message);
    return success({ status: true, digest: null });
  }
}
