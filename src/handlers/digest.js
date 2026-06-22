import { getTodaysDigest } from "../libs/digest-lib";
import { success } from "../libs/response-lib";

// GET /news/digest — return today's Daily Pull Digest if it exists. READ-ONLY and fast:
// generation happens only in the scheduled generate_digest Lambda, so this endpoint never blocks on
// an OpenAI call (which would blow past the API Gateway / caller timeout). Always returns 200;
// `digest` is null when today's digest hasn't been generated yet.
export async function main() {
  try {
    const digest = await getTodaysDigest();
    return success({ status: true, digest: digest || null });
  } catch (e) {
    console.error("digest handler error:", e.message);
    return success({ status: true, digest: null });
  }
}
