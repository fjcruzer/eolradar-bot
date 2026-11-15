import { describe, expect, it } from "vitest";
import {
  handleSocketEnvelope,
  readSocketUrl,
  runSocketMode,
  type SocketTransport,
} from "../src/slack/socket-mode";

describe("handleSocketEnvelope", () => {
  it("acks a slash command with the reply payload", async () => {
    const decision = await handleSocketEnvelope(
      {
        envelope_id: "env-1",
        type: "slash_commands",
        accepts_response_payload: true,
        payload: { command: "/eol", text: "eks", user_id: "U1", channel_id: "C1" },
      },
      (command) => {
        expect(command).toEqual({ command: "/eol", text: "eks", userId: "U1", channelId: "C1" });
        return Promise.resolve({ response_type: "ephemeral", text: "EKS", blocks: [] });
      },
    );
    expect(decision.reconnect).toBe(false);
    expect(decision.ack).toEqual({
      envelope_id: "env-1",
      payload: { response_type: "ephemeral", text: "EKS", blocks: [] },
    });
  });

  it("acks a disconnect and asks the connection to restart", async () => {
    const decision = await handleSocketEnvelope({ type: "disconnect", envelope_id: "env-2", reason: "refresh_requested" }, () => {
      throw new Error("not a command");
    });
    expect(decision).toEqual({ ack: { envelope_id: "env-2" }, reconnect: true });
  });

  it("does not ack a hello frame", async () => {
    const decision = await handleSocketEnvelope({ type: "hello" }, () => {
      throw new Error("not a command");
    });
    expect(decision).toEqual({ ack: null, reconnect: false });
  });

  it("acks with an ephemeral error when the command throws", async () => {
    const decision = await handleSocketEnvelope(
      { envelope_id: "env-3", type: "slash_commands", accepts_response_payload: true, payload: { text: "eks" } },
      () => Promise.reject(new Error("boom")),
    );
    expect(decision.reconnect).toBe(false);
    expect(decision.ack).toMatchObject({
      envelope_id: "env-3",
      payload: { response_type: "ephemeral" },
    });
  });
});

describe("readSocketUrl", () => {
  it("accepts the wss url and rejects anything else", () => {
    expect(readSocketUrl({ ok: true, url: "wss://wss-primary.slack.com/link/?ticket=abc" })).toBe(
      "wss://wss-primary.slack.com/link/?ticket=abc",
    );
    expect(() => readSocketUrl({ ok: false, error: "invalid_auth" })).toThrow(/invalid_auth/);
    expect(() => readSocketUrl({ ok: true, url: "https://evil.example/socket" })).toThrow(/invalid_url/);
  });
});

describe("runSocketMode", () => {
  it("sends the slash-command ack on the socket Slack opened", async () => {
    const sockets: FakeSocket[] = [];
    const controller = new AbortController();
    const done = runSocketMode({
      appToken: "xapp-test",
      signal: controller.signal,
      fetchImpl: () => Promise.resolve(Response.json({ ok: true, url: "wss://wss-primary.slack.com/link/?ticket=abc" })),
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      sleep: () => {
        controller.abort();
        return Promise.resolve();
      },
      onSlashCommand: () => Promise.resolve({ response_type: "ephemeral", text: "from-socket", blocks: [] }),
    });

    await waitFor(() => sockets.length === 1);
    const socket = sockets[0];
    if (!socket) throw new Error("missing socket");
    socket.emit("message", { data: JSON.stringify({ type: "hello" }) });
    socket.emit("message", {
      data: JSON.stringify({
        envelope_id: "env-9",
        type: "slash_commands",
        accepts_response_payload: true,
        payload: { command: "/eol", text: "eks", user_id: "U1", channel_id: "C1" },
      }),
    });
    await waitFor(() => socket.sent.some((frame) => frame.includes("env-9")));
    expect(JSON.parse(socket.sent.find((frame) => frame.includes("env-9")) ?? "{}")).toMatchObject({
      envelope_id: "env-9",
      payload: { text: "from-socket" },
    });
    socket.close();
    await done;
  });
});

class FakeSocket implements SocketTransport {
  sent: string[] = [];
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type: string, event: { data?: unknown } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit("close");
  }
}

async function waitFor(ready: () => boolean): Promise<void> {
  const started = Date.now();
  while (!ready()) {
    if (Date.now() - started > 1_000) throw new Error("timed out waiting for socket mode");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
