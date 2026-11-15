import type { HttpCache } from "../core/cache";
import type { KeyValueStore } from "./types";

const PREFIX = "http:";

/** HTTP cache for the EOL Radar client, backed by whatever store the process opened. */
export function storeHttpCache(store: KeyValueStore): HttpCache {
  return {
    async get(url: string): Promise<string | null> {
      return store.get(PREFIX + url);
    },
    async set(url: string, body: string, maxAgeSeconds: number): Promise<void> {
      if (maxAgeSeconds <= 0) return;
      await store.set(PREFIX + url, body, { ttlSeconds: maxAgeSeconds });
    },
  };
}
