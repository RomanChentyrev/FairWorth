# Fairworth deployment runbook

This deployment targets a Linux VPS with Docker Engine and Compose v2. PostgreSQL should be a managed service with provider snapshots enabled. Staging and production must use different databases, domains, JWT secrets, API credentials, SMTP credentials, Sentry environments and partner sandbox/live accounts.

## 1. DNS and host preparation

Point the staging and production `A`/`AAAA` records to their respective hosts. Allow inbound TCP 22, 80 and 443 and UDP 443. On each host create:

```bash
sudo mkdir -p /opt/fairworth/{deploy,config,secrets,backups,releases}
sudo chown -R "$USER" /opt/fairworth
```

Copy the repository `deploy/` directory to `/opt/fairworth/deploy`. Keep application secrets outside the repository:

```text
/opt/fairworth/config/staging.env
/opt/fairworth/config/production.env
/opt/fairworth/secrets/staging.server.env
/opt/fairworth/secrets/production.server.env
```

Use the corresponding `*.example` files as templates and run `chmod 600` on all four files. Replace `REGISTRY_IMAGE` with the lowercase GHCR package path. Log the server into GHCR with a read-only package token:

```bash
docker login ghcr.io
```

Do not place secrets in Compose, GitHub workflow files or Docker images.

## 2. Environments

GitHub repository settings must contain two Environments: `staging` and `production`. Add these secrets to each environment:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS` (obtain out of band from the host administrator)
- `VITE_SENTRY_DSN`

Require reviewer approval for the `production` Environment. A successful push to `staging` builds immutable images and deploys staging. Production deployment is started with **Actions → Deploy → Run workflow**, selecting `production` and the already-tested commit SHA.

The workflow does not copy secrets or alter DNS. Its SSH account should be restricted to the deployment host and have only the Docker permissions needed for this stack.

## 3. Releases and migrations

Manual release (the CI/CD workflow calls the same command):

```bash
/opt/fairworth/deploy/scripts/release.sh staging COMMIT_SHA
/opt/fairworth/deploy/scripts/release.sh production COMMIT_SHA
```

Before every release the script creates a logical PostgreSQL backup. Compose then runs the one-shot `migrate` container. Migrations are filename-ordered, transactional and protected with a PostgreSQL advisory lock. The API has `RUN_MIGRATIONS_ON_START=false`, so multiple replicas cannot race to change the schema.

Migrations must follow expand/contract deployment rules: first add backwards-compatible structures, deploy code that uses them, and only remove old structures in a later release. Never edit a migration that has already reached staging or production.

## 4. Backups

Enable daily managed-database snapshots and point-in-time recovery when the PostgreSQL provider supports them. The included logical backup is a second recovery path:

```bash
/opt/fairworth/deploy/scripts/backup-postgres.sh \
  /opt/fairworth/secrets/production.server.env \
  /opt/fairworth/backups/production
```

Schedule it daily with cron (the release script also backs up immediately before migrations):

```cron
15 2 * * * /opt/fairworth/deploy/scripts/backup-postgres.sh /opt/fairworth/secrets/production.server.env /opt/fairworth/backups/production >> /var/log/fairworth-backup.log 2>&1
```

`BACKUP_RETENTION_DAYS` defaults to 14. Encrypt and copy backups to storage in another failure domain. At least monthly, restore the latest backup into a disposable database and verify row counts and application readiness. An untested backup is not a recovery plan.

## 5. Rollback

The release script waits for `https://DOMAIN/api/ready`; if readiness fails, it restores the previous API and web image tags automatically. A manual application rollback is:

```bash
/opt/fairworth/deploy/scripts/rollback.sh production
```

This intentionally does not reverse database migrations. Backwards-compatible migrations make the previous image usable. If a destructive data migration has damaged data, stop writes, create a final incident snapshot, and restore a verified backup only after confirming the recovery point:

```bash
/opt/fairworth/deploy/scripts/restore-postgres.sh \
  /opt/fairworth/secrets/production.server.env \
  /opt/fairworth/backups/production/fairworth-TIMESTAMP.dump
```

Database restore is destructive and requires typing `RESTORE` interactively. Record the deployed SHA, migration list and recovery point in the incident log.

## 6. Verification

After each deployment check:

```bash
curl -fsS https://YOUR_DOMAIN/api/live
curl -fsS https://YOUR_DOMAIN/api/ready
docker compose --env-file /opt/fairworth/config/production.env \
  -f /opt/fairworth/deploy/docker-compose.deploy.yml ps
```

Then smoke-test registration/email verification, login, hotel search, provider redirect and partner postback. `/api/health` is the deeper dependency diagnostic; `/api/live` and `/api/ready` are deliberately fast probes for orchestration.
