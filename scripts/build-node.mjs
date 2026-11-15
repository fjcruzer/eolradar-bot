import { readFileSync } from "node:fs";
import { build } from "esbuild";

await build({
  entryPoints: ["src/node/main.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/server.js",
  sourcemap: true,
  legalComments: "none",
  // Node built-ins stay as imports. node:sqlite is imported dynamically so a
  // memory or file store does not load the experimental module.
  external: ["node:*"],
});

const bundled = readFileSync("dist/server.js", "utf8");
if (bundled.includes("caches.default") || bundled.includes("cloudflare-cache")) {
  console.error("The Node bundle includes the Cloudflare cache. The Worker adapter must stay out of this build.");
  process.exit(1);
}
const staticSqlite = /^import\s+.*node:sqlite/m.test(bundled);
if (staticSqlite) {
  console.error("node:sqlite was bundled as a static import. Keep it behind a dynamic import.");
  process.exit(1);
}
