# Fairworth deployment runbook

This deployment targets a Linux VPS with Docker Engine and Compose v2. PostgreSQL should be a managed service with provider snapshots enabled. Staging and production must use different databases, domains, JWT secrets, API credentials, SMTP credentials, Sentry environments and partner sandbox/live accounts.

The stack also runs a single notification worker. It checks hotel price watches, schedules trip reminders and weekly insights, and drains the PostgreSQL-backed email queue. Do not scale the worker by copying Compose projects; multiple replicas are safe for email delivery locks, but scheduler work is intentionally sized for one MVP worker.

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

### Closed MVP access gate

The deployment protects every page and API endpoint with Caddy Basic Auth except
`/api/ready`, which remains public for deployment readiness checks.

Generate a password hash without storing the plaintext password in Git:

```bash
docker run --rm -i caddy:2.8-alpine caddy hash-password
```

Set `ACCESS_GATE_USER` and the resulting bcrypt hash in the protected deployment
environment file. Keep the hash single-quoted because it contains `$` characters.
Share the HTTPS URL, username and plaintext password with approved testers through
a password manager or another secure channel.

## 2. Environments

GitHub repository settings must contain two Environments: `staging` and `production`. Add these secrets to each environment:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS` (obtain out of band from the host administrator)

Add `VITE_SENTRY_DSN` as a repository-level Actions secret because the immutable
frontend image is built by the CI workflow before a deployment Environment is
selected. The DSN is embedded in the public browser bundle and must belong to the
Tripalora frontend Sentry project. The server project DSN remains in the protected
`SERVER_ENV_FILE` as `SENTRY_DSN`. Follow [SENTRY.md](SENTRY.md) to create the
projects, alert rules, and verification events.

Require reviewer approval for the `production` Environment. A successful push to `staging` builds immutable images. Deployment is started with **Actions → Deploy → Run workflow**, selecting the target environment and an already-tested commit SHA. Until a separate staging host, domain and database exist, deploy only `production` manually after CI succeeds.

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

Enable managed-database snapshots and point-in-time recovery when PostgreSQL
supports them. Tripalora also creates a verified logical dump every day and before
each release, then copies it to private S3-compatible object storage in another
failure domain.

Create a private bucket dedicated to backups. Enable provider-side encryption,
disable public access, and create a separate access key limited to listing,
uploading, reading, and deleting objects only inside this bucket. Do not reuse the
main cloud-account credentials.

Install the upload client on the VPS:

```bash
sudo apt-get update
sudo apt-get install -y rclone
```

Create the protected backup configuration:

```bash
cp /opt/fairworth/deploy/backup.env.example \
  /opt/fairworth/secrets/backup.production.env
nano /opt/fairworth/secrets/backup.production.env
chmod 600 /opt/fairworth/secrets/backup.production.env
```

Set the S3 endpoint, region, bucket, prefix, and dedicated access-key pair. Keep
`BACKUP_S3_ENABLED=true`. Local dumps are retained for 14 days by default and
remote dumps for 90 days. Configure the bucket lifecycle to expire objects after
the same or a longer remote retention period as a second enforcement layer.

Keep `BACKUP_RCLONE_CRYPT_ENABLED=true` so database contents and object names
are encrypted before leaving the server. Generate two independent recovery
secrets, store their original values in the password manager, and put the output
of `rclone obscure` in `BACKUP_RCLONE_CRYPT_PASSWORD` and
`BACKUP_RCLONE_CRYPT_PASSWORD2`. Each upload is downloaded through the crypt
remote and compared byte-for-byte with the local dump before success is reported.

Test one complete backup and remote upload before enabling the schedule:

```bash
/opt/fairworth/deploy/scripts/daily-backup.sh production
ls -lh /opt/fairworth/backups/production
```

Confirm the new object exists in the bucket. Then install the daily systemd timer:

```bash
/opt/fairworth/deploy/scripts/install-backup-timer.sh production
sudo systemctl start fairworth-backup@production.service
sudo systemctl status fairworth-backup@production.service --no-pager
sudo journalctl -u fairworth-backup@production.service -n 100 --no-pager
sudo systemctl list-timers fairworth-backup@production.timer --no-pager
```

The timer runs at 02:15 UTC with a random delay of up to 15 minutes. It uses
`Persistent=true`, so systemd starts a missed backup after the server returns.
`flock` prevents a scheduled backup and a release backup from running together.
Both paths apply local and remote rotation from the protected backup config.

At least monthly, download the latest remote object, restore it into a disposable
database, and verify row counts and application readiness. A successful upload is
not proof that the dump can be restored.

The local restore drill never connects to production PostgreSQL:

```bash
/opt/fairworth/deploy/scripts/verify-backup-restore.sh \
  /opt/fairworth/backups/production/fairworth-TIMESTAMP.dump
```

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

Before preparing a server release, run the local clean-database rehearsal:

```bash
npm run acceptance:local
```

It includes migration idempotence and a destructive backup/restore drill against an isolated `fairworth_acceptance` database. It never drops the normal development database.

After each deployment check:

```bash
curl -fsS https://YOUR_DOMAIN/api/live
curl -fsS https://YOUR_DOMAIN/api/ready
docker compose --env-file /opt/fairworth/config/production.env \
  -f /opt/fairworth/deploy/docker-compose.deploy.yml ps
```

Then smoke-test registration/email verification, login and hotel search. Test provider redirect and partner postback only when `PARTNER_BOOKING_ENABLED=true`; the closed MVP keeps them disabled. `/api/health` is the deeper dependency diagnostic; `/api/live` and `/api/ready` are deliberately fast probes for orchestration.
