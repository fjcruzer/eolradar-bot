import { createFileStore } from "./file";
import { createMemoryStore } from "./memory";
import type { KeyValueStore, StoreKind } from "./types";

export async function openStore(kind: StoreKind, path: string): Promise<KeyValueStore> {
  if (kind === "memory") return createMemoryStore();
  if (kind === "file") return createFileStore(path);
  const { createSqliteStore } = await import("./sqlite");
  return createSqliteStore(path);
}
