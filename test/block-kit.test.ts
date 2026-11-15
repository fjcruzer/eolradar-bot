import { describe, expect, it } from "vitest";
import { toBlockKit } from "../src/core/block-kit";
import { createMessage } from "../src/core/message";
import { presentService } from "../src/core/present";
import { eks } from "./fixtures";

describe("toBlockKit", () => {
  it("renders a service as a header, sections, and a link button", () => {
    const view = toBlockKit(presentService(eks));
    const header = view.blocks.find((block) => block.type === "header");
    expect(header).toMatchObject({ text: { text: "Amazon EKS" } });
    const sectionText = view.blocks
      .filter((block) => block.type === "section")
      .map((block) => (block.type === "section" ? block.text.text : ""))
      .join("\n");
    expect(sectionText).toContain("*1.37*");
    expect(sectionText).toContain("2027-12-01");
    expect(sectionText).toContain("2028-12-01");
    expect(sectionText).toContain("Standard support");
    const actions = view.blocks.find((block) => block.type === "actions");
    expect(actions).toMatchObject({
      elements: expect.arrayContaining([
        expect.objectContaining({
          url: "https://eolradar.dev/services/eks/",
          action_id: "link_0",
        }),
      ]),
    });
    expect(view.text).toContain("Amazon EKS");
    for (const block of view.blocks) {
      if (block.type === "section") expect(block.text.text.length).toBeLessThanOrEqual(3000);
    }
  });

  it("splits a long body into several sections under the Block Kit limit", () => {
    const paragraphs = Array.from({ length: 80 }, (_, index) => [
      { kind: "text" as const, text: `version ${index} `.repeat(20) },
    ]);
    const view = toBlockKit(
      createMessage({
        title: "Long list",
        paragraphs,
        links: [{ url: "https://eolradar.dev/", label: "EOL Radar" }],
      }),
    );
    const sections = view.blocks.filter((block) => block.type === "section");
    expect(sections.length).toBeGreaterThan(1);
    for (const section of sections) {
      if (section.type === "section") expect(section.text.text.length).toBeLessThanOrEqual(2900);
    }
    expect(view.blocks.length).toBeLessThanOrEqual(50);
  });
});
