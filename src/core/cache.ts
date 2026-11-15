/**
 * Short-lived cache for EOL Radar documents.
 * The public API sends `Cache-Control: public, max-age=300`.
 */

export interface HttpCache {
  get(url: string): Promise<string | null>;
  set(url: string, body: string, maxAgeSeconds: number): Promise<void>;
}

/**
 * How long a successful response may be stored.
 * Returns null when the response must not be stored.
 * A missing header uses 300 seconds, which is the TTL the API documents.
 */
export function cacheTtlFromHeader(cacheControl: string | null): number | null {
  if (cacheControl === null || cacheControl.trim() === "") return 300;
  if (/(?:^|,)\s*(?:no-store|private)\b/i.test(cacheControl)) return null;
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl);
  const seconds = match?.[1];
  if (seconds === undefined) return 300;
  return Number(seconds);
}

export class MemoryCache implements HttpCache {
  private readonly entries = new Map<string, { body: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(url: string): Promise<string | null> {
    const entry = this.entries.get(url);
    if (!entry) return null;
    // Fresh while age is not greater than max-age (RFC 9111).
    if (this.now() > entry.expiresAt) {
      this.entries.delete(url);
      return null;
    }
    return entry.body;
  }

  async set(url: string, body: string, maxAgeSeconds: number): Promise<void> {
    if (maxAgeSeconds <= 0) return;
    this.entries.set(url, {
      body,
      expiresAt: this.now() + maxAgeSeconds * 1000,
    });
  }
}
