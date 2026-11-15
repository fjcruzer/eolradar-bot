import { describe, expect, it } from "vitest";
import type { EolClient } from "../src/core/client";
import type { BotMessage } from "../src/core/message";
import { parseSlugList } from "../src/core/digest";
import { runDigestJob } from "../src/digest-job";
import { services, upcoming } from "./fixtures";

const client: EolClient = {
  async listServices() {
    return services;
  },
  async getService() {
    throw new Error("not used");
  },
  async upcoming() {
    return upcoming;
  },
};

describe("parseSlugList", () => {
  it("treats empty, all, and * as every service", () => {
    expect(parseSlugList(undefined)).toBeNull();
    expect(parseSlugList("")).toBeNull();
    expect(parseSlugList(" all ")).toBeNull();
    expect(parseSlugList("*")).toBeNull();
    expect(parseSlugList("eks, rds-postgresql")).toEqual(["eks", "rds-postgresql"]);
  });
});

describe("runDigestJob", () => {
  it("skips the post when no channel is configured", async () => {
    let posted = 0;
    const result = await runDigestJob({
      client,
      channel: "  ",
      services: "",
      token: "xoxb-test",
      post: () => {
        posted += 1;
        return Promise.resolve();
      },
    });
    expect(result).toEqual({ posted: false, reason: "no_channel" });
    expect(posted).toBe(0);
  });

  it("posts the 90-day digest for the configured services", async () => {
    const sent: Array<{ channel: string; message: BotMessage }> = [];
    const result = await runDigestJob({
      client,
      channel: "C0123ABCDEF",
      services: "eks",
      token: "xoxb-test",
      post: (channel, message) => {
        sent.push({ channel, message });
        return Promise.resolve();
      },
    });
    expect(result).toEqual({ posted: true, reason: "posted" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.channel).toBe("C0123ABCDEF");
    expect(sent[0]?.message.fallbackText).toContain("Amazon EKS");
    expect(sent[0]?.message.fallbackText).not.toContain("Neptune");
  });
});
