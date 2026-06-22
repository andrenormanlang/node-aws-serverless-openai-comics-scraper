import { generateDigest } from "../libs/digest-lib";

// Scheduled (≈06:00 Malmö) — build today's Daily Pull Digest if it does not exist yet.
export async function main() {
  console.log("generate_digest invoked:", new Date().toISOString());

  const digest = await generateDigest({ force: false });

  return {
    statusCode: 200,
    body: {
      response: digest ? "ok" : "no-digest",
    },
  };
}
