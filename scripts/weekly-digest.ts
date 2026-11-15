/**
 * GitHub Actions alternative to the Worker cron.
 *   SLACK_BOT_TOKEN=... SLACK_DIGEST_CHANNEL=... DIGEST_SERVICES=... npx tsx scripts/weekly-digest.ts
 * Remove the cron from wrangler.jsonc if you use this, so the digest is not posted twice.
 */
import { createEolClient } from "../src/core/client";
import { runDigestJob } from "../src/digest-job";
import { postSlackMessage } from "../src/slack/api";

interface ProcessEnv {
  env?: Record<string, string | undefined>;
}

const env = (globalThis as { process?: ProcessEnv }).process?.env ?? {};

const result = await runDigestJob({
  client: createEolClient({ baseUrl: env["EOL_API_BASE"] ?? "https://eolradar.dev" }),
  channel: env["SLACK_DIGEST_CHANNEL"],
  services: env["DIGEST_SERVICES"],
  token: env["SLACK_BOT_TOKEN"],
  post: (channel, message) =>
    postSlackMessage({ token: env["SLACK_BOT_TOKEN"] ?? "", channel, message }),
});

console.log(JSON.stringify({ message: "weekly_digest", ...result }));
if (!result.posted && result.reason === "no_token") processExit(1);
if (!result.posted && result.reason === "no_channel") processExit(1);

function processExit(code: number): never {
  const exit = (globalThis as { process?: { exit: (status: number) => never } }).process?.exit;
  if (exit) return exit(code);
  throw new Error(`exit ${code}`);
}
