import { describe, expect, it } from "vitest";
import { toBlockKit } from "../src/core/block-kit";
import { buildDigest } from "../src/core/digest";
import { spansToPlain } from "../src/core/message";
import {
  presentService,
  presentServiceList,
  presentUpcoming,
} from "../src/core/present";
import type { EolClient } from "../src/core/client";
import { eks, lambdaSample, services, upcoming } from "./fixtures";

describe("presentService", () => {
  it("includes version, both support dates, status, and the service page", () => {
    const message = presentService(eks);
    expect(message.title).toBe("Amazon EKS");
    expect(message.fallbackText).toContain("1.37");
    expect(message.fallbackText).toContain("Standard support");
    expect(message.fallbackText).toContain("2027-12-01");
    expect(message.fallbackText).toContain("2028-12-01");
    expect(message.fallbackText).toContain("https://eolradar.dev/services/eks/");
    expect(message.links.map((link) => link.url)).toContain("https://eolradar.dev/services/eks/");
  });

  it("says when a date was not published", () => {
    const message = presentService(lambdaSample);
    expect(message.fallbackText).toContain("Node.js 26");
    expect(message.fallbackText).toContain("Unknown");
    expect(message.fallbackText).toContain("Standard support end: not published");
    expect(message.fallbackText).toContain("Node.js 24");
    expect(message.fallbackText).toContain("2028-04-30");
    expect(message.fallbackText).toContain(".NET 8");
    expect(message.fallbackText).toContain("Ended");
  });
});

describe("presentServiceList", () => {
  it("lists slugs from the index, including names that contain &", () => {
    const message = presentServiceList(services);
    expect(message.fallbackText).toContain("eks");
    expect(message.fallbackText).toContain("rds-postgresql");
    expect(message.fallbackText).toContain("Google Cloud SQL (MySQL & PostgreSQL)");
    const blocks = toBlockKit(message);
    const mrkdwn = blocks.blocks
      .filter((block) => block.type === "section")
      .map((block) => (block.type === "section" ? block.text.text : ""))
      .join("\n");
    expect(mrkdwn).toContain("MySQL &amp; PostgreSQL");
    expect(mrkdwn).toContain("`eks`");
    expect(message.fallbackText).not.toContain("&amp;");
  });
});

describe("presentUpcoming", () => {
  it("uses the requested window and keeps month-only dates", () => {
    const days30 = presentUpcoming(upcoming, 30);
    expect(days30.fallbackText).toContain("2026-11-26");
    expect(days30.fallbackText).toContain("Amazon EKS 1.31 — extended support ends");
    expect(days30.fallbackText).toContain("2026-11");
    expect(days30.fallbackText).toContain("last day of that month");
    expect(days30.fallbackText).not.toContain("Neptune");

    const days90 = presentUpcoming(upcoming, 90);
    expect(days90.fallbackText).toContain("Amazon Neptune engine versions");
    expect(spansToPlain(days90.paragraphs.find((line) => spansToPlain(line).includes("1.31")) ?? [])).toContain(
      "https://eolradar.dev/services/eks/",
    );
  });
});

describe("buildDigest", () => {
  const client: EolClient = {
    async listServices() {
      return services;
    },
    async getService() {
      return eks;
    },
    async upcoming() {
      return upcoming;
    },
  };

  it("limits the 90-day window to configured slugs and reports unknown ones", async () => {
    const message = await buildDigest(client, ["eks", "not-a-service"]);
    expect(message.title).toBe("Weekly EOL Radar digest");
    expect(message.fallbackText).toContain("Amazon EKS 1.31");
    expect(message.fallbackText).toContain("Amazon EKS 1.34");
    expect(message.fallbackText).not.toContain("Neptune");
    expect(message.fallbackText).not.toContain("Azure Kubernetes");
    expect(message.fallbackText).toContain("not-a-service");
  });

  it("includes every 90-day deadline when no filter is configured", async () => {
    const message = await buildDigest(client, null);
    expect(message.fallbackText).toContain("Neptune");
    expect(message.fallbackText).toContain("Azure Kubernetes");
  });
});
