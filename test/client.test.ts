import { describe, expect, it } from "vitest";
import { cacheTtlFromHeader, MemoryCache } from "../src/core/cache";
import { createEolClient, parseServiceIndex } from "../src/core/client";
import { EolApiError } from "../src/core/errors";
import { eks, notFoundBody, services } from "./fixtures";

function jsonResponse(body: unknown, status = 200, cacheControl = "public, max-age=300"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": cacheControl },
  });
}

describe("cacheTtlFromHeader", () => {
  it("reads max-age and refuses to store private or no-store responses", () => {
    expect(cacheTtlFromHeader("public, max-age=300")).toBe(300);
    expect(cacheTtlFromHeader(null)).toBe(300);
    expect(cacheTtlFromHeader("public, max-age=10")).toBe(10);
    expect(cacheTtlFromHeader("no-store")).toBeNull();
    expect(cacheTtlFromHeader("private, max-age=300")).toBeNull();
    expect(cacheTtlFromHeader("max-age=0")).toBe(0);
  });
});

describe("createEolClient", () => {
  it("parses the service index fixture", () => {
    expect(services.schema_version).toBe("1");
    expect(services.services.map((service) => service.slug)).toContain("rds-postgresql");
    expect(eks.versions[0]).toMatchObject({
      version: "1.37",
      standard_support_end: "2027-12-01",
      extended_support_end: "2028-12-01",
      status: "standard",
    });
  });

  it("caches a 200 for the Cache-Control max-age and then fetches again", async () => {
    let now = 1_000_000;
    let calls = 0;
    const client = createEolClient({
      baseUrl: "https://eolradar.dev",
      cache: new MemoryCache(() => now),
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(jsonResponse(services));
      },
    });
    await client.listServices();
    await client.listServices();
    expect(calls).toBe(1);
    now += 300_000;
    await client.listServices();
    expect(calls).toBe(1);
    now += 1;
    await client.listServices();
    expect(calls).toBe(2);
  });

  it("does not cache no-store, errors, or a schema mismatch", async () => {
    let calls = 0;
    const cache = new MemoryCache(() => 0);
    const client = createEolClient({
      baseUrl: "https://eolradar.dev/",
      cache,
      fetchImpl: () => {
        calls += 1;
        if (calls === 1) return Promise.resolve(jsonResponse(services, 200, "no-store"));
        return Promise.resolve(jsonResponse({ schema_version: "2", generated_at: "2026-11-15T00:00:00Z" }, 200));
      },
    });
    await client.listServices();
    await expect(client.listServices()).rejects.toMatchObject({ kind: "schema" });
    expect(calls).toBe(2);
    expect(await cache.get("https://eolradar.dev/api/v1/services.json")).toBeNull();
  });

  it("surfaces not_found and does not cache it", async () => {
    let calls = 0;
    const client = createEolClient({
      baseUrl: "https://eolradar.dev",
      cache: new MemoryCache(() => 0),
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(jsonResponse(notFoundBody, 404));
      },
    });
    await expect(client.getService("does-not-exist")).rejects.toBeInstanceOf(EolApiError);
    await expect(client.getService("does-not-exist")).rejects.toMatchObject({ kind: "not_found" });
    expect(calls).toBe(2);
  });

  it("turns a network failure into an API error", async () => {
    const client = createEolClient({
      baseUrl: "https://eolradar.dev",
      fetchImpl: () => Promise.reject(new Error("dns")),
    });
    await expect(client.upcoming()).rejects.toMatchObject({ kind: "network" });
  });

  it("rejects a document that is not the supported schema before caching it", () => {
    expect(() => parseServiceIndex({ schema_version: "2", generated_at: "t", services: [] })).toThrow(
      EolApiError,
    );
  });
});
