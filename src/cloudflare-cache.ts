import type { HttpCache } from "./core/cache";

/** Cache API store. Entries honor the Cache-Control max-age passed to `set`. */
export function cloudflareHttpCache(): HttpCache {
  return {
    async get(url: string): Promise<string | null> {
      const hit = await caches.default.match(new Request(url, { method: "GET" }));
      if (!hit) return null;
      return hit.text();
    },
    async set(url: string, body: string, maxAgeSeconds: number): Promise<void> {
      if (maxAgeSeconds <= 0) return;
      await caches.default.put(
        new Request(url, { method: "GET" }),
        new Response(body, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": `public, max-age=${maxAgeSeconds}`,
          },
        }),
      );
    },
  };
}
