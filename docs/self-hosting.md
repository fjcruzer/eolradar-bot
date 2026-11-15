# Self-hosting

The self-hosted bot is a Node.js process. It does not use Cloudflare. It only makes outbound connections: HTTPS to [eolradar.dev](https://eolradar.dev/) and to Slack, plus a WebSocket to Slack when [Socket Mode](#socket-mode) is on.

You still need a Slack app. You do not need a Cloudflare account, a public inbound URL (if you use Socket Mode), or a paid host. Run one of the three layouts below. They all start the same server.

Node.js 22 or newer is required. The Cloudflare Worker path is unchanged and is documented in the [README](../README.md).

## Configure the Slack app

Create the app at [https://api.slack.com/apps](https://api.slack.com/apps). The bot needs the `commands` and `chat:write` bot scopes, then **Install to Workspace**.

Two ways to deliver `/eol`:

### HTTP request URL

Use this when the process has a public HTTPS URL.

1. Create the app from [`slack-app-manifest.yml`](../slack-app-manifest.yml). Replace the request URL host with yours. The path is `/slack/commands`, for example `https://eol.example.com/slack/commands`.
2. Copy **Basic Information → Signing Secret** into `SLACK_SIGNING_SECRET`.
3. Copy **OAuth & Permissions → Bot User OAuth Token** (`xoxb-...`) into `SLACK_BOT_TOKEN`.

Slack must be able to reach that URL. The process checks the signature on each command.

### Socket Mode

Use this when the network can open outbound connections but cannot accept an inbound URL.

1. Create the app from [`examples/slack-app-manifest.socket.yml`](../examples/slack-app-manifest.socket.yml). The slash command has no request URL, and `socket_mode_enabled` is true.
2. After the app exists, open **Basic Information → App-Level Tokens**. Generate a token with the `connections:write` scope. A manifest cannot create this token. Put it in `SLACK_APP_TOKEN` (`xapp-...`).
3. Install the app and set `SLACK_BOT_TOKEN` as above. Socket Mode does not use the signing secret.

The process calls `apps.connections.open` and keeps the WebSocket Slack returns. `/eol` arrives on that socket and the reply is sent back on it. The digest still uses `chat.postMessage` with the bot token.

You can leave `SLACK_APP_TOKEN` empty and use HTTP only. If both are set, HTTP and Socket Mode both answer `/eol`.

## Environment

Copy [`.env.example`](../.env.example) to `.env` for a shell or for Docker Compose. Do not commit `.env`. Variables that are already set in the environment win over the file.

| Name | Default | Purpose |
| --- | --- | --- |
| `EOL_API_BASE` | `https://eolradar.dev` | API origin. HTTPS only. |
| `SLACK_SIGNING_SECRET` | empty | Verifies HTTP slash commands. |
| `SLACK_BOT_TOKEN` | empty | `chat.postMessage` for the digest. |
| `SLACK_DIGEST_CHANNEL` | empty | Channel id (`C...`). Empty skips the digest. |
| `DIGEST_SERVICES` | empty | Comma-separated slugs. `all` or empty means every service. |
| `SLACK_APP_TOKEN` | empty | App-level token. Setting it turns Socket Mode on. |
| `PORT` | `8080` | HTTP port. `0` picks a free port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `STORE` | `memory` | `memory`, `file`, or `sqlite`. |
| `STORE_PATH` | `./data/eolradar-bot.json` (`.sqlite` for sqlite) | File used when `STORE` is `file` or `sqlite`. |
| `DIGEST_CRON` | `0 14 * * MON` | UTC cron for the digest. `off` disables it. |
| `DIGEST_CATCHUP_MINUTES` | `15` | Post a missed slot when the process starts within this many minutes of it. `0` disables catch-up. |

`0 14 * * MON` is Monday 14:00 UTC, the same instant as the Worker cron. Day-of-week numbers are POSIX (`1` is Monday, `0` and `7` are Sunday). Names `SUN`–`SAT` are accepted.

Run only one digest scheduler. The Worker cron, this process, and [`examples/weekly-digest.github-workflow.yml`](../examples/weekly-digest.github-workflow.yml) all post the same message. Set `DIGEST_CRON=off` here if something else posts it, or remove the Worker cron if this process posts it.

The store keeps the short-lived API cache and a record of the last digest slot so a restart in the same minute does not post twice. `memory` is enough for one process and works on a read-only filesystem. `file` is a JSON file. `sqlite` uses Node's built-in `node:sqlite` module, which Node 22 still marks experimental (the process logs a warning the first time it opens the database). A Redis or Postgres backend can implement the same `get` / `set` / `delete` / `add` operations later. Nothing in this repository connects to either.

`GET /health` and `GET /healthz` return `{"ok":true}` when the process is up. `GET /readyz` returns 200 when the store answers and, if Socket Mode is configured, after the WebSocket has received Slack's hello. It returns 503 before that.

The process can start before the Slack values are set. Commands then fail until you add them, and the digest skips until a channel and bot token are set.

## Script

```bash
npm ci
npm test
npm run build
cp .env.example .env
# edit .env
npm start
```

`npm start` runs `dist/server.js`. `npm run dev:server` runs the TypeScript entry with `tsx` and does not need a build.

An example unit is [`deploy/systemd/eolradar-bot.service`](../deploy/systemd/eolradar-bot.service). It expects Node at `/usr/bin/node`, the built tree at `/opt/eolradar-bot`, secrets in `/etc/eolradar-bot.env`, and a system user `eolradar`. systemd's `StateDirectory` creates `/var/lib/eolradar-bot` for the file store.

```bash
sudo useradd --system --home-dir /opt/eolradar-bot eolradar
sudo install -d -o eolradar -g eolradar /opt/eolradar-bot
sudo cp -a dist package.json /opt/eolradar-bot/
sudo cp .env.example /etc/eolradar-bot.env
sudoedit /etc/eolradar-bot.env
sudo cp deploy/systemd/eolradar-bot.service /etc/systemd/system/eolradar-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now eolradar-bot
```

## Container

The image is published to `ghcr.io/fjcruzer/eolradar-bot` from this repository's GitHub Actions workflow on `main` and on `v*` tags, using `GITHUB_TOKEN` only. The published image is `linux/amd64`. Build the Dockerfile yourself for another architecture. The first push creates the GHCR package; its visibility is controlled in the package settings.

```bash
cp .env.example .env
# edit .env
docker compose up --build
```

Compose stores the file store at `/data/store.json` on a named volume, runs as uid 1000, and drops capabilities. The image healthcheck calls `/healthz`.

Without Compose:

```bash
docker build -t eolradar-bot .
docker run --rm -p 8080:8080 --env-file .env -e DIGEST_CRON=off eolradar-bot
curl -fsS http://127.0.0.1:8080/healthz
```

The runtime image does not install Wrangler or application `node_modules`. The server is a single bundled file.

## Kubernetes and Helm

Plain manifests are in [`deploy/kubernetes/`](../deploy/kubernetes/). They run one replica, with a `Recreate` strategy, as uid 1000, with a read-only root filesystem, dropped capabilities, and liveness (`/healthz`) and readiness (`/readyz`) probes.

```bash
kubectl apply -k deploy/kubernetes
kubectl rollout status deployment/eolradar-bot
```

That does not create a Secret. Copy [`deploy/kubernetes/secret.example.yaml`](../deploy/kubernetes/secret.example.yaml), fill it in somewhere outside the repo, and apply that copy. The Deployment tolerates a missing Secret: the pod starts and serves health checks, and Slack calls fail until the values exist.

[`deploy/kubernetes/ingress.yaml`](../deploy/kubernetes/ingress.yaml) is not part of the kustomization. Apply it only for HTTP mode, after setting the host. Socket Mode does not need an Ingress.

The digest scheduler is in-process. Keep `replicas: 1` while `DIGEST_CRON` is not `off`. Two pods would each post the Monday digest. The Helm chart refuses `replicaCount` greater than 1 in that case.

```bash
helm install eolradar-bot deploy/helm/eolradar-bot \
  --set secret.existingSecret=eolradar-bot
```

Create that Secret first (the keys are the same as the example manifest). To keep a file store:

```bash
helm install eolradar-bot deploy/helm/eolradar-bot \
  --set secret.existingSecret=eolradar-bot \
  --set config.store=file \
  --set config.storePath=/data/store.json \
  --set persistence.enabled=true
```

`persistence.enabled` with `config.store=memory` is rejected. Chart defaults and the singleton rule are in [`deploy/helm/eolradar-bot/values.yaml`](../deploy/helm/eolradar-bot/values.yaml).

## What is left

- A Microsoft Teams adapter can call `runCommand` and `buildDigest` and render `BotMessage` itself. That was already the split of this repo, and it is still open.
- Redis and Postgres are not implemented. The store interface is `get`, `set`, `delete`, and `add`.
- More than one replica while the scheduler is on would need a leader election that this chart does not do. Turn the cron off and scale, or keep one replica.
- The published container image is `linux/amd64` only.
