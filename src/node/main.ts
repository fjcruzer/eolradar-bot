import { readFile } from "node:fs/promises";
import { handleBotRequest, runConfiguredDigest } from "../app";
import { applyEnvFile } from "../env-file";
import { claimDigestSlot, releaseDigestSlot, startDigestSchedule } from "../scheduler";
import { executeSlashCommand } from "../slack/command";
import { runSocketMode } from "../slack/socket-mode";
import { storeHttpCache } from "../store/http-cache";
import { openStore } from "../store/open";
import type { KeyValueStore } from "../store/types";
import { createEolClient } from "../core/client";
import { loadConfig, type NodeConfig } from "./config";
import { startNodeServer, type NodeServer } from "./server";

async function main(): Promise<void> {
  const env = await loadEnvironment();
  const config = loadConfig(env);
  if (config.slackSigningSecret.length === 0 && config.slackAppToken.length === 0) {
    console.error(JSON.stringify({ message: "slack_credentials_missing" }));
  }
  if (config.slackAppToken.length > 0 && !config.slackAppToken.startsWith("xapp-")) {
    console.error(JSON.stringify({ message: "slack_app_token_prefix" }));
  }

  const store = await openStore(config.store, config.storePath);
  const cache = storeHttpCache(store);
  const client = createEolClient({ baseUrl: config.eolApiBase, cache });
  const state = { socketReady: config.slackAppToken.length === 0 };
  const socketAbort = new AbortController();

  const server = await startNodeServer({
    host: config.host,
    port: config.port,
    handler: (request) =>
      handleBotRequest(request, {
        signingSecret: config.slackSigningSecret,
        createClient: () => client,
        ready: () => ready(store, state.socketReady),
      }),
  });

  const schedule =
    config.digestCron === "off"
      ? { stop() {} }
      : startDigestSchedule({
          cron: config.digestCron,
          catchupMs: config.digestCatchupMinutes * 60 * 1000,
          onError(error) {
            console.error(
              JSON.stringify({
                message: "digest_failed",
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          },
          run: (slot) => postDigest(config, store, slot),
        });

  if (config.slackAppToken.length > 0) {
    void runSocketMode({
      appToken: config.slackAppToken,
      signal: socketAbort.signal,
      onConnectionChange(ready) {
        state.socketReady = ready;
      },
      onSlashCommand: async (command) => {
        console.log(
          JSON.stringify({
            message: "slash_command",
            command: command.command,
            text: command.text,
            user_id: command.userId,
            channel_id: command.channelId,
          }),
        );
        return executeSlashCommand(command.text, client);
      },
    }).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          message: "socket_mode_stopped",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  }

  console.log(
    JSON.stringify({
      message: "listening",
      host: config.host,
      port: server.port,
      store: config.store,
      socketMode: config.slackAppToken.length > 0,
      digestCron: config.digestCron,
    }),
  );

  installShutdown({ server, store, schedule, socketAbort });
}

async function postDigest(config: NodeConfig, store: KeyValueStore, slot: string): Promise<void> {
  const claimed = await claimDigestSlot(store, slot);
  if (!claimed) {
    console.log(JSON.stringify({ message: "digest_slot_skipped", slot }));
    return;
  }
  try {
    const result = await runConfiguredDigest({
      eolApiBase: config.eolApiBase,
      cache: storeHttpCache(store),
      channel: config.slackDigestChannel,
      services: config.digestServices,
      token: config.slackBotToken,
    });
    console.log(JSON.stringify({ message: "digest_finished", slot, ...result }));
  } catch (error) {
    await releaseDigestSlot(store, slot);
    throw error;
  }
}

async function ready(store: KeyValueStore, socketReady: boolean): Promise<boolean> {
  if (!socketReady) return false;
  await store.set("health:ready", "1", { ttlSeconds: 60 });
  return (await store.get("health:ready")) === "1";
}

async function loadEnvironment(): Promise<NodeJS.ProcessEnv> {
  const env = process.env;
  const path = env["EOLRADAR_ENV_FILE"] ?? ".env";
  try {
    applyEnvFile(await readFile(path, "utf8"), env);
  } catch (error) {
    if (!isEnoent(error)) throw error;
  }
  return env;
}

function installShutdown(input: {
  server: NodeServer;
  store: KeyValueStore;
  schedule: { stop(): void };
  socketAbort: AbortController;
}): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ message: "shutdown", signal }));
    input.socketAbort.abort();
    input.schedule.stop();
    const force = setTimeout(() => process.exit(0), 10_000);
    force.unref();
    void input.server
      .close()
      .then(async () => {
        await input.store.close?.();
        process.exit(0);
      })
      .catch((error: unknown) => {
        console.error(
          JSON.stringify({
            message: "shutdown_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        process.exit(1);
      });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

process.on("unhandledRejection", (error: unknown) => {
  console.error(
    JSON.stringify({
      message: "unhandled_rejection",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      message: "startup_failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
