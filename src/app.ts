import { createEolClient, type EolClient } from "./core/client";
import type { HttpCache } from "./core/cache";
import { runDigestJob, type DigestJobResult } from "./digest-job";
import { postSlackMessage } from "./slack/api";
import { handleSlackCommand } from "./slack/command";

export interface BotRequestDeps {
  signingSecret: string;
  createClient: () => EolClient;
  nowMs?: number;
  /** When omitted, /readyz reports ready. The Node server checks its store and Socket Mode connection. */
  ready?: () => Promise<boolean>;
}

/**
 * HTTP routes shared by the Worker and the Node server.
 * `/health` is the Worker check. `/healthz` and `/readyz` are the container and Kubernetes checks.
 */
export async function handleBotRequest(request: Request, deps: BotRequestDeps): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
      return Response.json({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/readyz") {
      return readyResponse(deps.ready);
    }
    if (url.pathname === "/slack/commands") {
      return handleSlackCommand(request, {
        signingSecret: deps.signingSecret,
        client: deps.createClient(),
        nowMs: deps.nowMs,
      });
    }
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "request_failed",
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return new Response("Internal error", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export async function runConfiguredDigest(input: {
  eolApiBase: string;
  cache?: HttpCache;
  channel: string;
  services: string;
  token: string;
}): Promise<DigestJobResult> {
  const token = input.token;
  return runDigestJob({
    client: createEolClient({ baseUrl: input.eolApiBase, cache: input.cache }),
    channel: input.channel,
    services: input.services,
    token,
    post: (channel, message) => postSlackMessage({ token, channel, message }),
  });
}

async function readyResponse(ready: (() => Promise<boolean>) | undefined): Promise<Response> {
  try {
    const ok = ready ? await ready() : true;
    if (!ok) {
      return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "ready_check_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ ok: true });
}
