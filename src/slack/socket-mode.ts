import type { SlackCommandPayload } from "./api";
import type { SlackCommandRequest } from "./command";

/**
 * Slack Socket Mode client. Slack connects outbound from this process, so the
 * bot does not need a public request URL. Slash commands are acknowledged on
 * the same WebSocket.
 * https://docs.slack.dev/apis/events-api/using-socket-mode/
 */

const OPEN_URL = "https://slack.com/api/apps.connections.open";
const MAX_BACKOFF_MS = 30_000;

export interface SocketDecision {
  ack: Record<string, unknown> | null;
  reconnect: boolean;
}

export interface SocketTransport {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
}

export async function handleSocketEnvelope(
  message: unknown,
  onSlashCommand: (command: SlackCommandRequest) => Promise<SlackCommandPayload>,
): Promise<SocketDecision> {
  if (!isRecord(message)) return { ack: null, reconnect: false };
  const type = typeof message["type"] === "string" ? message["type"] : "";
  if (type === "hello") return { ack: null, reconnect: false };
  const envelopeId = typeof message["envelope_id"] === "string" ? message["envelope_id"] : null;
  if (envelopeId === null) return { ack: null, reconnect: false };
  if (type === "disconnect") return { ack: { envelope_id: envelopeId }, reconnect: true };
  if (type === "slash_commands") {
    try {
      const reply = await onSlashCommand(slashCommandFromPayload(message["payload"]));
      if (message["accepts_response_payload"] === true) {
        return { ack: { envelope_id: envelopeId, payload: reply }, reconnect: false };
      }
      return { ack: { envelope_id: envelopeId }, reconnect: false };
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "socket_command_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return {
        ack: {
          envelope_id: envelopeId,
          payload: {
            response_type: "ephemeral",
            text: "EOL Radar hit an unexpected error. Try again in a few minutes.",
          },
        },
        reconnect: false,
      };
    }
  }
  return { ack: { envelope_id: envelopeId }, reconnect: false };
}

export function readSocketUrl(body: unknown): string {
  if (!isRecord(body) || body["ok"] !== true || typeof body["url"] !== "string") {
    const reason = isRecord(body) && typeof body["error"] === "string" ? body["error"] : "invalid_response";
    throw new Error(`Slack apps.connections.open failed: ${reason}`);
  }
  let url: URL;
  try {
    url = new URL(body["url"]);
  } catch {
    throw new Error("Slack apps.connections.open failed: invalid_url");
  }
  if (url.protocol !== "wss:") throw new Error("Slack apps.connections.open failed: invalid_url");
  return url.toString();
}

export async function runSocketMode(options: {
  appToken: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  createSocket?: (url: string) => SocketTransport;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  onConnectionChange?: (ready: boolean) => void;
  onSlashCommand: (command: SlackCommandRequest) => Promise<SlackCommandPayload>;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const createSocket = options.createSocket ?? connectWebSocket;
  const sleep = options.sleep ?? sleepWithAbort;
  let backoff = 1_000;
  while (!options.signal.aborted) {
    let hello = false;
    try {
      const url = await openSocketUrl(options.appToken, fetchImpl);
      const session = await runOneConnection(createSocket(url), options.signal, options.onSlashCommand, () => {
        hello = true;
        options.onConnectionChange?.(true);
      });
      hello = session.hello || hello;
    } catch (error) {
      if (options.signal.aborted) return;
      console.error(
        JSON.stringify({
          message: "socket_mode_error",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    if (options.signal.aborted) return;
    options.onConnectionChange?.(false);
    if (hello) backoff = 1_000;
    await sleep(backoff, options.signal);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}

async function openSocketUrl(appToken: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(OPEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Slack apps.connections.open failed: HTTP ${response.status}`);
  }
  return readSocketUrl(body);
}

function runOneConnection(
  socket: SocketTransport,
  signal: AbortSignal,
  onSlashCommand: (command: SlackCommandRequest) => Promise<SlackCommandPayload>,
  onHello: () => void,
): Promise<{ hello: boolean }> {
  return new Promise((resolve) => {
    let hello = false;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve({ hello });
    };
    const onAbort = (): void => {
      socket.close();
      finish();
    };
    if (signal.aborted) {
      socket.close();
      finish();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    socket.addEventListener("close", () => finish());
    socket.addEventListener("error", () => socket.close());
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data) as unknown;
      } catch {
        console.error(JSON.stringify({ message: "socket_mode_invalid_json" }));
        return;
      }
      if (isRecord(parsed) && parsed["type"] === "hello") {
        hello = true;
        onHello();
      }
      void handleSocketEnvelope(parsed, onSlashCommand)
        .then((decision) => {
          if (decision.ack) socket.send(JSON.stringify(decision.ack));
          if (decision.reconnect) socket.close();
        })
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              message: "socket_mode_handler_failed",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        });
    });
  });
}

function connectWebSocket(url: string): SocketTransport {
  const socket = new WebSocket(url);
  return {
    send(data: string) {
      socket.send(data);
    },
    close() {
      socket.close();
    },
    addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
      const onEvent = (event: Event): void => {
        if (event instanceof MessageEvent) listener({ data: event.data });
        else listener({});
      };
      if (type === "message") socket.addEventListener("message", onEvent);
      else if (type === "open") socket.addEventListener("open", onEvent);
      else if (type === "close") socket.addEventListener("close", onEvent);
      else if (type === "error") socket.addEventListener("error", onEvent);
    },
  };
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function slashCommandFromPayload(payload: unknown): SlackCommandRequest {
  const record = isRecord(payload) ? payload : {};
  return {
    command: typeof record["command"] === "string" ? record["command"] : "",
    text: typeof record["text"] === "string" ? record["text"] : "",
    userId: typeof record["user_id"] === "string" ? record["user_id"] : "",
    channelId: typeof record["channel_id"] === "string" ? record["channel_id"] : "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
