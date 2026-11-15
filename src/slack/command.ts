import type { EolClient } from "../core/client";
import { runCommand } from "../core/commands";
import { jsonResponse, slashCommandResponse } from "./api";
import { verifySlackSignature } from "./verify";

const MAX_BODY_CHARS = 100_000;

export interface SlackCommandRequest {
  command: string;
  text: string;
  userId: string;
  channelId: string;
}

export async function handleSlackCommand(
  request: Request,
  input: { signingSecret: string; client: EolClient; nowMs?: number },
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (input.signingSecret.length === 0) {
    console.error(JSON.stringify({ message: "slack_signing_secret_missing" }));
    return new Response("Slack signing secret is not configured", { status: 500 });
  }

  const body = await request.text();
  if (body.length > MAX_BODY_CHARS) {
    return new Response("Payload too large", { status: 413 });
  }

  const valid = await verifySlackSignature({
    secret: input.signingSecret,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
    body,
    nowMs: input.nowMs ?? Date.now(),
  });
  if (!valid) {
    console.error(JSON.stringify({ message: "slack_signature_rejected" }));
    return new Response("Invalid signature", { status: 401 });
  }

  const form = parseSlackForm(body);
  console.log(
    JSON.stringify({
      message: "slash_command",
      command: form.command,
      text: form.text,
      user_id: form.userId,
      channel_id: form.channelId,
    }),
  );

  try {
    const message = await runCommand(form.text, input.client);
    return jsonResponse(slashCommandResponse(message));
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "slash_command_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return jsonResponse(
      slashCommandResponse({
        fallbackText: "EOL Radar hit an unexpected error. Try again in a few minutes.",
        paragraphs: [
          [{ kind: "text", text: "EOL Radar hit an unexpected error. Try again in a few minutes." }],
        ],
        links: [],
      }),
    );
  }
}

export function parseSlackForm(body: string): SlackCommandRequest {
  const params = new URLSearchParams(body);
  return {
    command: params.get("command") ?? "",
    text: params.get("text") ?? "",
    userId: params.get("user_id") ?? "",
    channelId: params.get("channel_id") ?? "",
  };
}
