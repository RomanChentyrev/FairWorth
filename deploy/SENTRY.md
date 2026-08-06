# Sentry setup for Tripalora

Tripalora sends server failures and browser crashes to separate Sentry projects. Keep the server DSN in the server secret file. The browser DSN is embedded in the client bundle and is therefore configured as a GitHub Actions repository secret.

## 1. Create projects

Create two projects in the same Sentry organization:

- `tripalora-api`, platform Node.js / Express;
- `tripalora-web`, platform React.

Use the production DSN from `tripalora-api` as `SENTRY_DSN`. Use the DSN from `tripalora-web` as `VITE_SENTRY_DSN`. Do not send either value in chat or commit it to Git.

## 2. Configure the API

On the production server, edit:

```bash
nano /opt/fairworth/secrets/production.server.env
```

Set:

```dotenv
SENTRY_DSN=https://PUBLIC_KEY@SENTRY_HOST/PROJECT_ID
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROVIDER_EVENT_INTERVAL_MS=300000
```

`SENTRY_ENVIRONMENT` and `SENTRY_RELEASE` are injected by Docker Compose. The release is the immutable image SHA selected for deployment.

## 3. Configure the browser build

In GitHub open `Settings -> Secrets and variables -> Actions -> Secrets -> New repository secret` and create:

```text
VITE_SENTRY_DSN
```

This must be a repository-level Actions secret, not only an Environment secret: the client image is built by CI before the production environment is selected. The DSN identifies the Sentry ingestion project but does not grant access to the Sentry account.

Trigger CI after adding the secret so the client image is rebuilt with the DSN. Deploy the resulting immutable commit SHA.

## 4. Create alert rules

Create issue or metric alerts in the production environment and send notifications to the MVP operations email or team channel.

| Alert | Sentry search/filter | Suggested threshold |
| --- | --- | --- |
| New API 5xx | `event.kind:http_5xx environment:production` | First new issue and 3 events in 5 minutes |
| Frontend crash | `event.kind:frontend_crash environment:production` | First new issue and 3 affected users in 10 minutes |
| Provider degradation | `event.kind:provider_degraded environment:production` | 3 events in 10 minutes, grouped by `provider` and `provider.operation` |
| Worker failure | `event.kind:worker_failure environment:production` | Any new issue |

Provider events include `provider`, `provider.status`, and `provider.operation` tags. Repeated identical events are throttled in the application for five minutes by default, so alert thresholds should not assume every failed upstream request creates an event.

## 5. Verify after deployment

Check the API health response:

```bash
curl -fsS https://tripalora.com/api/health
```

The `checks.sentry` object must report `configured` and show the deployed release SHA.

Send one server verification event from the running API container:

```bash
cd /opt/fairworth
docker compose --env-file config/production.env \
  -f deploy/docker-compose.deploy.yml exec api node -e \
  "const {Sentry,enabled}=require('./instrument'); if(!enabled) throw new Error('Sentry is disabled'); Sentry.captureMessage('Tripalora API Sentry verification'); Sentry.flush(3000).then(ok=>process.exit(ok?0:1))"
```

For the browser project, open Tripalora, then run this once in browser DevTools:

```js
setTimeout(() => { throw new Error('Tripalora frontend Sentry verification'); }, 0);
```

Confirm that both events have `environment=production` and the same immutable release SHA. Delete or resolve the verification issues afterward.

## 6. Data and privacy

The integration does not enable default PII collection. Authorization and cookie headers are removed from server events. Do not attach API keys, provider payloads containing personal data, passenger details, or booking form values to Sentry contexts.

Source-map upload is not enabled yet. Before public production, add a Sentry organization auth token with only the permissions required by CI and upload hidden source maps for `tripalora-web`; this makes minified browser stack traces actionable without serving source maps publicly.
