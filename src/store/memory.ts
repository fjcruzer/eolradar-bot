import { expiryTimestamp, isExpired, type KeyValueStore } from "./types";

interface Entry {
  value: string;
  expiresAt: number | null;
}

export function createMemoryStore(now: () => number = Date.now): KeyValueStore {
  const entries = new Map<string, Entry>();

  function live(key: string): Entry | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (isExpired(entry.expiresAt, now())) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    async get(key: string): Promise<string | null> {
      return live(key)?.value ?? null;
    },

    async set(key: string, value: string, options?: { ttlSeconds?: number }): Promise<void> {
      const expiresAt = expiryTimestamp(now(), options?.ttlSeconds);
      if (expiresAt === undefined) {
        entries.delete(key);
        return;
      }
      entries.set(key, { value, expiresAt });
    },

    async delete(key: string): Promise<void> {
      entries.delete(key);
    },

    async add(key: string, value: string, options?: { ttlSeconds?: number }): Promise<boolean> {
      const expiresAt = expiryTimestamp(now(), options?.ttlSeconds);
      if (expiresAt === undefined) return false;
      if (live(key)) return false;
      entries.set(key, { value, expiresAt });
      return true;
    },
  };
}
