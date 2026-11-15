import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { expiryTimestamp, isExpired, type KeyValueStore } from "./types";

/**
 * Node-only store on the built-in `node:sqlite` module. Do not import this from
 * the Worker entry. The module is loaded only when STORE=sqlite, because Node 22
 * still warns that it is experimental.
 */

interface SqliteStatement {
  get(...params: Array<string | number | null>): Record<string, unknown> | undefined;
  run(...params: Array<string | number | null>): { changes: number | bigint };
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export async function createSqliteStore(path: string, now: () => number = Date.now): Promise<KeyValueStore> {
  const sqlite = await import("node:sqlite");
  if (typeof sqlite.DatabaseSync !== "function") {
    throw new Error("node:sqlite did not provide DatabaseSync.");
  }
  const DatabaseSync = sqlite.DatabaseSync as new (path: string) => SqliteDatabase;
  await mkdir(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 3000");
  db.exec(`CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER
  )`);

  const select = db.prepare("SELECT value, expires_at FROM kv WHERE key = ?");
  const remove = db.prepare("DELETE FROM kv WHERE key = ?");
  const upsert = db.prepare(`INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`);
  const insertNew = db.prepare(
    "INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING",
  );
  const deleteExpired = db.prepare("DELETE FROM kv WHERE key = ? AND expires_at IS NOT NULL AND expires_at <= ?");

  function readLive(key: string, nowMs: number): string | null {
    const row = select.get(key);
    if (!row || typeof row["value"] !== "string") return null;
    const expiresAt = readExpiry(row["expires_at"]);
    if (isExpired(expiresAt, nowMs)) {
      remove.run(key);
      return null;
    }
    return row["value"];
  }

  return {
    async get(key: string): Promise<string | null> {
      return readLive(key, now());
    },

    async set(key: string, value: string, options?: { ttlSeconds?: number }): Promise<void> {
      const expiresAt = expiryTimestamp(now(), options?.ttlSeconds);
      if (expiresAt === undefined) {
        remove.run(key);
        return;
      }
      upsert.run(key, value, expiresAt);
    },

    async delete(key: string): Promise<void> {
      remove.run(key);
    },

    async add(key: string, value: string, options?: { ttlSeconds?: number }): Promise<boolean> {
      const nowMs = now();
      const expiresAt = expiryTimestamp(nowMs, options?.ttlSeconds);
      if (expiresAt === undefined) return false;
      // One writer at a time. Two processes sharing this file serialize here.
      db.exec("BEGIN IMMEDIATE");
      try {
        deleteExpired.run(key, nowMs);
        const inserted = insertNew.run(key, value, expiresAt);
        db.exec("COMMIT");
        return Number(inserted.changes) === 1;
      } catch (error) {
        rollback(db);
        throw error;
      }
    },

    async close(): Promise<void> {
      db.close();
    },
  };
}

function readExpiry(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return null;
}

function rollback(db: SqliteDatabase): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    // The transaction is already closed when COMMIT itself failed.
  }
}
