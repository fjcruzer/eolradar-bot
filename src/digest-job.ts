import { buildDigest, parseSlugList } from "./core/digest";
import type { EolClient } from "./core/client";
import type { BotMessage } from "./core/message";

export interface DigestJobResult {
  posted: boolean;
  reason: "posted" | "no_channel" | "no_token";
}

/**
 * Weekly digest. A missing channel is a configuration skip, not a failure.
 * A Slack post error is thrown so the cron invocation is marked failed.
 */
export async function runDigestJob(input: {
  client: EolClient;
  channel: string | undefined;
  services: string | undefined;
  token: string | undefined;
  post: (channel: string, message: BotMessage) => Promise<void>;
}): Promise<DigestJobResult> {
  const channel = input.channel?.trim() ?? "";
  if (channel.length === 0) {
    console.error(JSON.stringify({ message: "digest_skipped", reason: "no_channel" }));
    return { posted: false, reason: "no_channel" };
  }
  const token = input.token?.trim() ?? "";
  if (token.length === 0) {
    console.error(JSON.stringify({ message: "digest_skipped", reason: "no_token" }));
    return { posted: false, reason: "no_token" };
  }
  const message = await buildDigest(input.client, parseSlugList(input.services));
  await input.post(channel, message);
  return { posted: true, reason: "posted" };
}
