import { describe, expect, it } from "vitest";
import { applyEnvFile, parseEnvFile } from "../src/env-file";
import { DEFAULT_DIGEST_CRON } from "../src/scheduler";
import { loadConfig } from "../src/node/config";

describe("loadConfig", () => {
  it("uses memory storage, port 8080, and the Monday digest by default", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      eolApiBase: "https://eolradar.dev",
      host: "0.0.0.0",
      port: 8080,
      store: "memory",
      storePath: "./data/eolradar-bot.json",
      digestCron: DEFAULT_DIGEST_CRON,
      digestCatchupMinutes: 15,
      slackSigningSecret: "",
      slackAppToken: "",
    });
  });

  it("accepts file and sqlite paths and a disabled digest", () => {
    expect(loadConfig({ STORE: "file", STORE_PATH: "/data/bot.json" })).toMatchObject({
      store: "file",
      storePath: "/data/bot.json",
    });
    expect(loadConfig({ STORE: "sqlite" }).storePath).toBe("./data/eolradar-bot.sqlite");
    expect(loadConfig({ DIGEST_CRON: "off" }).digestCron).toBe("off");
    expect(loadConfig({ PORT: "0" }).port).toBe(0);
  });

  it("rejects a bad store, port, or cron", () => {
    expect(() => loadConfig({ STORE: "redis" })).toThrow(/STORE/);
    expect(() => loadConfig({ PORT: "70000" })).toThrow(/PORT/);
    expect(() => loadConfig({ DIGEST_CRON: "tomorrow" })).toThrow(/DIGEST_CRON/);
    expect(() => loadConfig({ DIGEST_CATCHUP_MINUTES: "nope" })).toThrow(/DIGEST_CATCHUP_MINUTES/);
  });
});

describe("parseEnvFile", () => {
  it("reads assignments and does not override variables that are already set", () => {
    const parsed = parseEnvFile(`
      # comment
      export SLACK_BOT_TOKEN="xoxb-from-file"
      DIGEST_SERVICES=eks,lambda
      EMPTY=
    `);
    expect(parsed).toEqual({
      SLACK_BOT_TOKEN: "xoxb-from-file",
      DIGEST_SERVICES: "eks,lambda",
      EMPTY: "",
    });
    const env: Record<string, string | undefined> = { SLACK_BOT_TOKEN: "xoxb-from-env" };
    applyEnvFile(`SLACK_BOT_TOKEN=xoxb-from-file\nPORT=9090\n`, env);
    expect(env["SLACK_BOT_TOKEN"]).toBe("xoxb-from-env");
    expect(env["PORT"]).toBe("9090");
  });
});
