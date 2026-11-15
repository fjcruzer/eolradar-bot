import { describe, expect, it } from "vitest";
import type { EolClient } from "../src/core/client";
import { EolApiError } from "../src/core/errors";
import { handleSlackCommand } from "../src/slack/command";
import { verifySlackSignature } from "../src/slack/verify";
import { eks, services, upcoming } from "./fixtures";

const SECRET = "test-signing-secret";

const client: EolClient = {
  async listServices() {
    return services;
  },
  async getService(slug) {
    if (slug === "eks") return eks;
    throw new EolApiError("missing", "not_found");
  },
  async upcoming() {
    return upcoming;
  },
};

async function signedRequest(text: string, secret = SECRET, nowMs = 1_700_000_000_000): Promise<Request> {
  const body = new URLSearchParams({
    command: "/eol",
    text,
    user_id: "U123",
    channel_id: "C123",
  }).toString();
  const timestamp = String(Math.floor(nowMs / 1000));
  const signature = await sign(secret, timestamp, body);
  return new Request("https://eolradar-bot.example.workers.dev/slack/commands", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature,
    },
    body,
  });
}

async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`v0:${timestamp}:${body}`));
  const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `v0=${hex}`;
}

describe("handleSlackCommand", () => {
  it("rejects a missing signature", async () => {
    const request = new Request("https://example.test/slack/commands", {
      method: "POST",
      body: "command=%2Feol&text=eks",
    });
    const response = await handleSlackCommand(request, { signingSecret: SECRET, client });
    expect(response.status).toBe(401);
  });

  it("answers /eol eks with versions and the service link", async () => {
    const nowMs = 1_700_000_000_000;
    const request = await signedRequest("eks", SECRET, nowMs);
    const response = await handleSlackCommand(request, { signingSecret: SECRET, client, nowMs });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      response_type: string;
      text: string;
      blocks: Array<{ type: string; text?: { text: string }; elements?: Array<{ url: string }> }>;
    };
    expect(payload.response_type).toBe("ephemeral");
    expect(payload.text).toContain("1.37");
    expect(payload.text).toContain("2027-12-01");
    const button = payload.blocks
      .flatMap((block) => block.elements ?? [])
      .find((element) => element.url === "https://eolradar.dev/services/eks/");
    expect(button).toBeDefined();
  });

  it("answers a bare /eol with the service index", async () => {
    const nowMs = 1_700_000_000_000;
    const response = await handleSlackCommand(await signedRequest("", SECRET, nowMs), {
      signingSecret: SECRET,
      client,
      nowMs,
    });
    const payload = (await response.json()) as { text: string };
    expect(payload.text).toContain("rds-postgresql");
  });

  it("uses a signature the verifier accepts", async () => {
    const nowMs = 1_700_000_000_000;
    const request = await signedRequest("upcoming 30", SECRET, nowMs);
    const body = await request.clone().text();
    await expect(
      verifySlackSignature({
        secret: SECRET,
        timestamp: request.headers.get("x-slack-request-timestamp"),
        signature: request.headers.get("x-slack-signature"),
        body,
        nowMs,
      }),
    ).resolves.toBe(true);
  });
});
