import { DEFAULT_DIGEST_CRON, parseCron } from "../scheduler";
import type { StoreKind } from "../store/types";

export const DEFAULT_EOL_API_BASE = "https://eolradar.dev";

const DISABLED_CRON = new Set(["off", "false", "disabled", "none"]);

export interface NodeConfig {
  eolApiBase: string;
  slackSigningSecret: string;
  slackBotToken: string;
  slackDigestChannel: string;
  digestServices: string;
  slackAppToken: string;
  host: string;
  port: number;
  store: StoreKind;
  storePath: string;
  /** `"off"` disables the in-process scheduler. Otherwise a 5-field UTC cron expression. */
  digestCron: string;
  digestCatchupMinutes: number;
}

export function loadConfig(env: Record<string, string | undefined>): NodeConfig {
  const store = readStore(env["STORE"]);
  const digestCron = readCron(env["DIGEST_CRON"]);
  return {
    eolApiBase: readRequiredUrl(env["EOL_API_BASE"]),
    slackSigningSecret: readString(env["SLACK_SIGNING_SECRET"]),
    slackBotToken: readString(env["SLACK_BOT_TOKEN"]),
    slackDigestChannel: readString(env["SLACK_DIGEST_CHANNEL"]),
    digestServices: readString(env["DIGEST_SERVICES"]),
    slackAppToken: readString(env["SLACK_APP_TOKEN"]),
    host: readHost(env["HOST"]),
    port: readPort(env["PORT"]),
    store,
    storePath: readStorePath(store, env["STORE_PATH"]),
    digestCron,
    digestCatchupMinutes: readCatchup(env["DIGEST_CATCHUP_MINUTES"]),
  };
}

function readString(value: string | undefined): string {
  return value?.trim() ?? "";
}

function readRequiredUrl(value: string | undefined): string {
  const base = value === undefined || value.trim() === "" ? DEFAULT_EOL_API_BASE : value.trim();
  return base;
}

function readHost(value: string | undefined): string {
  if (value === undefined || value.trim() === "") return "0.0.0.0";
  return value.trim();
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 8080;
  if (!/^\d+$/.test(value.trim())) throw new Error(`PORT must be an integer. Received "${value}".`);
  const port = Number(value.trim());
  if (port > 65535) throw new Error(`PORT must be between 0 and 65535. Received "${value}".`);
  return port;
}

function readStore(value: string | undefined): StoreKind {
  const kind = (value ?? "memory").trim().toLowerCase();
  if (kind === "memory" || kind === "file" || kind === "sqlite") return kind;
  throw new Error(`STORE must be memory, file, or sqlite. Received "${value ?? ""}".`);
}

function readStorePath(kind: StoreKind, value: string | undefined): string {
  if (value !== undefined && value.trim() !== "") return value.trim();
  if (kind === "sqlite") return "./data/eolradar-bot.sqlite";
  return "./data/eolradar-bot.json";
}

function readCron(value: string | undefined): string {
  if (value === undefined || value.trim() === "") return DEFAULT_DIGEST_CRON;
  const trimmed = value.trim();
  if (DISABLED_CRON.has(trimmed.toLowerCase())) return "off";
  parseCron(trimmed);
  return trimmed;
}

function readCatchup(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 15;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`DIGEST_CATCHUP_MINUTES must be an integer. Received "${value}".`);
  }
  const minutes = Number(value.trim());
  if (minutes > 24 * 60) throw new Error("DIGEST_CATCHUP_MINUTES must be between 0 and 1440.");
  return minutes;
}
