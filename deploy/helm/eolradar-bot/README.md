# eolradar-bot

Helm chart for the self-hosted bot. Setup steps, Slack app differences, and the singleton scheduler note are in [docs/self-hosting.md](../../../docs/self-hosting.md).

```bash
helm install eolradar-bot ./deploy/helm/eolradar-bot
```

Put Slack tokens in an existing Secret (`secret.existingSecret`) rather than in a values file.
