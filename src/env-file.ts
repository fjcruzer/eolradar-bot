/**
 * Minimal `.env` reader for `npm start`. Existing environment variables win,
 * so systemd, Docker, and Kubernetes overrides are kept.
 * Values are not expanded and are never logged.
 */

export function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    const key = match?.[1];
    if (!match || key === undefined) continue;
    let value = match[2] ?? "";
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function applyEnvFile(text: string, env: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(parseEnvFile(text))) {
    if (env[key] === undefined) env[key] = value;
  }
}
