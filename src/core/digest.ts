import type { EolClient } from "./client";
import type { BotMessage } from "./message";
import { presentDigest } from "./present";

/** Comma-separated slugs. Empty, `all`, or `*` means every service. */
export function parseSlugList(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "*" || trimmed.toLowerCase() === "all") return null;
  const slugs = raw
    .split(",")
    .map((slug) => slug.trim().toLowerCase())
    .filter((slug) => slug.length > 0);
  return slugs.length === 0 ? null : slugs;
}

export async function buildDigest(
  client: EolClient,
  slugs: readonly string[] | null,
): Promise<BotMessage> {
  if (slugs === null) {
    return presentDigest(await client.upcoming(), null, new Set());
  }
  const [feed, index] = await Promise.all([client.upcoming(), client.listServices()]);
  const known = new Set(index.services.map((service) => service.slug));
  return presentDigest(feed, slugs, known);
}
