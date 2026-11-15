import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expiryTimestamp, isExpired, type KeyValueStore } from "./types";

/**
 * Node-only JSON file store. Do not import this from the Worker entry.
 * Writes are atomic (temp file, then rename) and serialized with a lock file.
 */

interface StoredEntry {
  value: string;
  expiresAt: number | null;
}

interface FileDocument {
  version: 1;
  entries: Record<string, StoredEntry>;
}

const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 10_000;

export function createFileStore(path: string, now: () => number = Date.now): KeyValueStore {
  const lockPath = `${path}.lock`;

  async function update<T>(mutate: (document: FileDocument, nowMs: number) => { result: T; dirty: boolean }): Promise<T> {
    await mkdir(dirname(path), { recursive: true });
    return withLock(lockPath, async () => {
      const nowMs = now();
      const document = await readDocument(path);
      const pruned = prune(document, nowMs);
      const { result, dirty } = mutate(document, nowMs);
      if (pruned || dirty) await writeDocument(path, document);
      return result;
    });
  }

  return {
    get(key: string): Promise<string | null> {
      return update((document) => {
        const entry = document.entries[key];
        return { result: entry?.value ?? null, dirty: false };
      });
    },

    set(key: string, value: string, options?: { ttlSeconds?: number }): Promise<void> {
      return update((document, nowMs) => {
        const expiresAt = expiryTimestamp(nowMs, options?.ttlSeconds);
        if (expiresAt === undefined) {
          const dirty = document.entries[key] !== undefined;
          delete document.entries[key];
          return { result: undefined, dirty };
        }
        document.entries[key] = { value, expiresAt };
        return { result: undefined, dirty: true };
      });
    },

    delete(key: string): Promise<void> {
      return update((document) => {
        const dirty = document.entries[key] !== undefined;
        delete document.entries[key];
        return { result: undefined, dirty };
      });
    },

    add(key: string, value: string, options?: { ttlSeconds?: number }): Promise<boolean> {
      return update((document, nowMs) => {
        const expiresAt = expiryTimestamp(nowMs, options?.ttlSeconds);
        if (expiresAt === undefined) return { result: false, dirty: false };
        if (document.entries[key]) return { result: false, dirty: false };
        document.entries[key] = { value, expiresAt };
        return { result: true, dirty: true };
      });
    },
  };
}

function prune(document: FileDocument, nowMs: number): boolean {
  let changed = false;
  for (const [key, entry] of Object.entries(document.entries)) {
    if (isExpired(entry.expiresAt, nowMs)) {
      delete document.entries[key];
      changed = true;
    }
  }
  return changed;
}

async function readDocument(path: string): Promise<FileDocument> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isCode(error, "ENOENT")) return { version: 1, entries: {} };
    throw error;
  }
  if (text.trim() === "") return { version: 1, entries: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Store file ${path} is not valid JSON.`, { cause: error });
  }
  if (!isDocument(parsed)) throw new Error(`Store file ${path} is not a version 1 document.`);
  return parsed;
}

async function writeDocument(path: string, document: FileDocument): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(document), "utf8");
  await rename(temporary, path);
}

function isDocument(value: unknown): value is FileDocument {
  if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1) return false;
  if (!("entries" in value) || typeof value.entries !== "object" || value.entries === null || Array.isArray(value.entries)) {
    return false;
  }
  for (const entry of Object.values(value.entries)) {
    if (typeof entry !== "object" || entry === null) return false;
    if (!("value" in entry) || typeof entry.value !== "string") return false;
    if (!("expiresAt" in entry) || (entry.expiresAt !== null && typeof entry.expiresAt !== "number")) return false;
  }
  return true;
}

async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(`${process.pid}\n${Date.now()}\n`);
        return await fn();
      } finally {
        await handle.close();
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
      const age = await lockAge(lockPath);
      if (age !== null && age > LOCK_STALE_MS) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() - started > LOCK_WAIT_MS) {
        throw new Error(`Timed out waiting for store lock ${lockPath}`, { cause: error });
      }
      await delay(20);
    }
  }
}

async function lockAge(lockPath: string): Promise<number | null> {
  try {
    const text = await readFile(lockPath, "utf8");
    const stamp = Number(text.split("\n")[1]);
    if (!Number.isFinite(stamp)) return null;
    return Date.now() - stamp;
  } catch (error) {
    if (isCode(error, "ENOENT")) return null;
    return null;
  }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
