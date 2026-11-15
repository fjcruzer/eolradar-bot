/**
 * Small key-value store used by the self-hosted bot.
 * Memory, a local JSON file, and Node's built-in SQLite implement this.
 * A Redis or Postgres adapter can implement the same four operations.
 */

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  /** `ttlSeconds` omitted means the value does not expire. `ttlSeconds` <= 0 stores nothing. */
  set(key: string, value: string, options?: { ttlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Store `value` only when `key` is absent or already expired.
   * Returns false when the key was already held or the TTL does not store.
   */
  add(key: string, value: string, options?: { ttlSeconds?: number }): Promise<boolean>;
  close?(): Promise<void>;
}

export type StoreKind = "memory" | "file" | "sqlite";

/** `null` means no expiry. `undefined` means the caller should not store the value. */
export function expiryTimestamp(nowMs: number, ttlSeconds: number | undefined): number | null | undefined {
  if (ttlSeconds === undefined) return null;
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return undefined;
  return nowMs + ttlSeconds * 1000;
}

/** Fresh while age is not greater than max-age, matching the in-memory HTTP cache. */
export function isExpired(expiresAt: number | null, nowMs: number): boolean {
  return expiresAt !== null && nowMs > expiresAt;
}
