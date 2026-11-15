# Contributing

Thanks for looking at EOL Radar Bot. The project is MIT licensed, copyright Aris Cruz.

## Development

```bash
npm ci
cp .dev.vars.example .dev.vars
npm test
npm run lint
npm run typecheck
```

`npm run dev` starts the Worker locally. Slack cannot reach localhost unless you use a tunnel, so signature checks are covered by unit tests. A request to `http://localhost:8787/health` should return `{"ok":true}`.

`npm run typecheck` regenerates `worker-configuration.d.ts` from `wrangler.jsonc`. That file is gitignored. Run it again after you change bindings or secrets in the Wrangler config.

Do not commit `.dev.vars`, tokens, or signing secrets.

## Layout

- `src/core` fetches the [EOL Radar JSON API](https://eolradar.dev/api/), parses `/eol` text, matches service names, and builds a `BotMessage`.
- `src/core/block-kit.ts` renders that message as Slack Block Kit.
- `src/slack` verifies Slack signatures, accepts slash commands, speaks Socket Mode, and calls `chat.postMessage`.
- `src/app.ts` is the HTTP app both runtimes serve (`/health`, `/healthz`, `/readyz`, `/slack/commands`).
- `src/index.ts` is the Worker adapter (`fetch`, and `scheduled` for the Monday digest).
- `src/node` is the Node.js server, its environment, and the in-process scheduler.
- `src/store` is the self-hosted key-value store (memory, a JSON file, or SQLite).

A Microsoft Teams adapter should call `runCommand` and `buildDigest`, then render `BotMessage` itself (for example as an Adaptive Card). It should not need to change the API client or the matcher.

## Tests

Vitest covers command parsing, fuzzy matching, message formatting, Block Kit limits, API parsing, cache TTL, and Slack signature checks. Fixtures in `test/fixtures` are trimmed snapshots of the public API (schema version `"1"`). Refresh them from:

- `https://eolradar.dev/api/v1/services.json`
- `https://eolradar.dev/api/v1/services/eks.json`
- `https://eolradar.dev/api/v1/upcoming.json`

Keep fixtures small. If `schema_version` changes, update the parser and the fixtures together. Do not point tests at the live API.

## Pull requests

GitHub Actions runs `npm run lint`, `npm test`, `npm run typecheck`, and `npm run build` on every pull request. A second job builds the container, calls `/healthz`, renders the Helm chart, and applies the Kubernetes manifests to a kind cluster.
