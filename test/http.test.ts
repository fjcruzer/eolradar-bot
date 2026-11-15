import { afterEach, describe, expect, it } from "vitest";
import { handleBotRequest } from "../src/app";
import type { EolClient } from "../src/core/client";
import { EolApiError } from "../src/core/errors";
import { startNodeServer, type NodeServer } from "../src/node/server";
import worker from "../src/index";
import { eks, services, upcoming } from "./fixtures";

const SECRET = "test-signing-secret";
const NOW = 1_700_000_000_000;

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

const servers: NodeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("handleBotRequest", () => {
  it("answers health checks without calling the API", async () => {
    for (const path of ["/health", "/healthz"]) {
      const response = await handleBotRequest(new Request(`https://bot.test${path}`), deps());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    }
  });

  it("reports readiness from the injected check", async () => {
    const ready = await handleBotRequest(new Request("https://bot.test/readyz"), deps());
    expect(ready.status).toBe(200);
    const notReady = await handleBotRequest(new Request("https://bot.test/readyz"), {
      ...deps(),
      ready: () => Promise.resolve(false),
    });
    expect(notReady.status).toBe(503);
    const broken = await handleBotRequest(new Request("https://bot.test/readyz"), {
      ...deps(),
      ready: () => Promise.reject(new Error("store down")),
    });
    expect(broken.status).toBe(503);
  });

  it("answers a signed /eol eks and rejects a bad signature", async () => {
    const response = await handleBotRequest(await signedRequest("eks"), deps());
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { text: string; response_type: string };
    expect(payload.response_type).toBe("ephemeral");
    expect(payload.text).toContain("1.37");

    const rejected = await handleBotRequest(
      new Request("https://bot.test/slack/commands", { method: "POST", body: "command=%2Feol&text=eks" }),
      deps(),
    );
    expect(rejected.status).toBe(401);
  });

  it("returns 404 for an unknown path", async () => {
    const response = await handleBotRequest(new Request("https://bot.test/nope"), deps());
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("node server", () => {
  it("serves health and a signed slash command over HTTP", async () => {
    const server = await startNodeServer({
      host: "127.0.0.1",
      port: 0,
      handler: (request) => handleBotRequest(request, deps()),
    });
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true });

    const signed = await signedRequest("upcoming 30");
    const body = await signed.text();
    const response = await fetch(`${base}/slack/commands`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-request-timestamp": signed.headers.get("x-slack-request-timestamp") ?? "",
        "x-slack-signature": signed.headers.get("x-slack-signature") ?? "",
      },
      body,
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { text: string };
    expect(payload.text.length).toBeGreaterThan(0);

    const missing = await fetch(`${base}/missing`);
    expect(missing.status).toBe(404);
  });
});

describe("worker adapter", () => {
  it("keeps /health and rejects an unsigned command without calling Slack", async () => {
    const env = {
      EOL_API_BASE: "https://eolradar.dev",
      SLACK_SIGNING_SECRET: SECRET,
      SLACK_BOT_TOKEN: "",
      SLACK_DIGEST_CHANNEL: "",
      DIGEST_SERVICES: "",
    };
    const health = await worker.fetch(new Request("https://bot.test/health"), env as never);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true });

    const healthz = await worker.fetch(new Request("https://bot.test/healthz"), env as never);
    expect(healthz.status).toBe(200);

    const rejected = await worker.fetch(
      new Request("https://bot.test/slack/commands", { method: "POST", body: "command=%2Feol" }),
      env as never,
    );
    expect(rejected.status).toBe(401);
  });

  it("skips the scheduled digest when no channel is configured", async () => {
    await expect(
      worker.scheduled(
        { cron: "0 14 * * MON", scheduledTime: NOW } as never,
        {
          EOL_API_BASE: "https://eolradar.dev",
          SLACK_SIGNING_SECRET: "",
          SLACK_BOT_TOKEN: "xoxb-test",
          SLACK_DIGEST_CHANNEL: "  ",
          DIGEST_SERVICES: "all",
        } as never,
      ),
    ).resolves.toBeUndefined();
  });
});

function deps() {
  return {
    signingSecret: SECRET,
    createClient: () => client,
    nowMs: NOW,
  };
}

async function signedRequest(text: string): Promise<Request> {
  const body = new URLSearchParams({ command: "/eol", text, user_id: "U123", channel_id: "C123" }).toString();
  const timestamp = String(Math.floor(NOW / 1000));
  return new Request("https://bot.test/slack/commands", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": await sign(SECRET, timestamp, body),
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
  return `v0=${[...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
