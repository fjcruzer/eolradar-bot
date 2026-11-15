import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { storeHttpCache } from "../src/store/http-cache";
import { createFileStore } from "../src/store/file";
import { createMemoryStore } from "../src/store/memory";
import { createSqliteStore } from "../src/store/sqlite";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("memory store", () => {
  it("expires values and claims a key once", async () => {
    let now = 1_000;
    const store = createMemoryStore(() => now);
    await store.set("a", "one", { ttlSeconds: 10 });
    expect(await store.get("a")).toBe("one");
    now = 11_000;
    expect(await store.get("a")).toBe("one");
    now = 11_001;
    expect(await store.get("a")).toBeNull();
    await expect(store.add("lock", "1", { ttlSeconds: 10 })).resolves.toBe(true);
    await expect(store.add("lock", "2", { ttlSeconds: 10 })).resolves.toBe(false);
    expect(await store.get("lock")).toBe("1");
  });
});

describe("file store", () => {
  it("persists across instances and serializes claims", async () => {
    const directory = await tempDir();
    const path = join(directory, "store.json");
    let now = 0;
    const first = createFileStore(path, () => now);
    await first.set("service", "eks", { ttlSeconds: 5 });
    const second = createFileStore(path, () => now);
    expect(await second.get("service")).toBe("eks");
    now = 5_001;
    expect(await second.get("service")).toBeNull();

    const claims = await Promise.all([second.add("slot", "a"), second.add("slot", "b")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const winner = await second.get("slot");
    expect(winner === "a" || winner === "b").toBe(true);
  });

  it("refuses a file that is not a store document", async () => {
    const directory = await tempDir();
    const path = join(directory, "store.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, "{\"version\":2}", "utf8");
    const store = createFileStore(path);
    await expect(store.get("a")).rejects.toThrow(/version 1/);
  });
});

describe("sqlite store", () => {
  it("persists across connections", async () => {
    const directory = await tempDir();
    const path = join(directory, "store.sqlite");
    const first = await createSqliteStore(path);
    await first.set("service", "lambda");
    await first.close?.();
    const second = await createSqliteStore(path);
    expect(await second.get("service")).toBe("lambda");
    await expect(second.add("slot", "1")).resolves.toBe(true);
    await expect(second.add("slot", "2")).resolves.toBe(false);
    await second.close?.();
  });
});

describe("storeHttpCache", () => {
  it("stores a body for the TTL the API allows", async () => {
    let now = 0;
    const store = createMemoryStore(() => now);
    const cache = storeHttpCache(store);
    const url = "https://eolradar.dev/api/v1/services.json";
    await cache.set(url, "{}", 0);
    expect(await cache.get(url)).toBeNull();
    await cache.set(url, "{\"ok\":true}", 10);
    expect(await cache.get(url)).toBe("{\"ok\":true}");
    now = 10_001;
    expect(await cache.get(url)).toBeNull();
  });
});

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "eolradar-bot-"));
  directories.push(directory);
  return directory;
}
