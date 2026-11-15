import { describe, expect, it } from "vitest";
import { resolveService } from "../src/core/match";
import { services } from "./fixtures";

describe("resolveService", () => {
  it("matches a slug exactly, ignoring case", () => {
    const result = resolveService("EKS", services.services);
    expect(result.type).toBe("match");
    if (result.type === "match") expect(result.service.slug).toBe("eks");
  });

  it("matches rds-postgres to Amazon RDS for PostgreSQL", () => {
    const result = resolveService("rds-postgres", services.services);
    expect(result).toMatchObject({ type: "match", service: { slug: "rds-postgresql" } });
  });

  it("matches a full service name", () => {
    const result = resolveService("amazon rds for postgresql", services.services);
    expect(result).toMatchObject({ type: "match", service: { slug: "rds-postgresql" } });
  });

  it("asks for a slug when several services share the query", () => {
    const result = resolveService("postgres", services.services);
    expect(result.type).toBe("ambiguous");
    if (result.type !== "ambiguous") return;
    const slugs = result.matches.map((service) => service.slug);
    expect(slugs).toContain("rds-postgresql");
    expect(slugs).toContain("aurora-postgresql");
    expect(slugs).toContain("azure-postgresql");
  });

  it("matches a one-character typo in a short slug", () => {
    const result = resolveService("ekz", services.services);
    expect(result).toMatchObject({ type: "match", service: { slug: "eks" } });
  });

  it("returns no match for an unrelated query", () => {
    const result = resolveService("not-a-cloud-product", services.services);
    expect(result.type).toBe("none");
  });
});
