#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../dist/server.js", import.meta.url));
if (!existsSync(entry)) {
  console.error("eolradar-bot is not built. From the repository, run: npm run build");
  process.exit(1);
}

const child = spawn(process.execPath, [entry], { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
