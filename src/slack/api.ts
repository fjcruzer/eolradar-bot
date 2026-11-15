import { toBlockKit } from "../core/block-kit";
import type { BotMessage } from "../core/message";

export interface SlackCommandPayload {
  response_type: "ephemeral";
  text: string;
  blocks: ReturnType<typeof toBlockKit>["blocks"];
}

export function slashCommandResponse(message: BotMessage): SlackCommandPayload {
  const view = toBlockKit(message);
  return {
    response_type: "ephemeral",
    text: view.text,
    blocks: view.blocks,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Post a message with the bot token. Throws when Slack rejects it. */
export async function postSlackMessage(input: {
  token: string;
  channel: string;
  message: BotMessage;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const view = toBlockKit(input.message);
  const response = await fetchImpl("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: input.channel,
      text: view.text,
      blocks: view.blocks,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });
  const payload: unknown = await response.json();
  if (!isSlackResult(payload) || !response.ok || !payload.ok) {
    const reason = isSlackResult(payload) ? (payload.error ?? `HTTP ${response.status}`) : `HTTP ${response.status}`;
    throw new Error(`Slack chat.postMessage failed: ${reason}`);
  }
}

function isSlackResult(value: unknown): value is { ok: boolean; error?: string } {
  if (typeof value !== "object" || value === null || !("ok" in value)) return false;
  if (typeof value.ok !== "boolean") return false;
  if ("error" in value && value.error !== undefined && typeof value.error !== "string") return false;
  return true;
}
