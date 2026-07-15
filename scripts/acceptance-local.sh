#!/bin/sh
set -eu

DB_NAME=${ACCEPTANCE_DB_NAME:-fairworth_acceptance}
DB_USER=${ACCEPTANCE_DB_USER:-fairworth}
BACKUP_FILE="/tmp/${DB_NAME}-acceptance.dump"
export DATABASE_URL="postgresql://${DB_USER}:fairworth@127.0.0.1:5433/${DB_NAME}"
export DATABASE_SSL=false
export CI=true
export AUTH_RATE_LIMIT=500
export PROVIDER_FIXTURES_ENABLED=true

cleanup() {
  docker compose exec -T postgres rm -f "$BACKUP_FILE" >/dev/null 2>&1 || true
  docker compose exec -T postgres dropdb -U "$DB_USER" --if-exists --force "$DB_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo '[1/10] Starting isolated dependencies'
docker compose up -d postgres mailpit

echo '[2/10] Creating a clean acceptance database'
docker compose exec -T postgres dropdb -U "$DB_USER" --if-exists --force "$DB_NAME"
docker compose exec -T postgres createdb -U "$DB_USER" "$DB_NAME"

echo '[3/10] Applying migrations from zero'
npm run setup
FIRST_MIGRATION_COUNT=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -Atc 'SELECT COUNT(*) FROM schema_migrations')
test "$FIRST_MIGRATION_COUNT" -gt 0

echo '[4/10] Re-running migrations to prove idempotence'
npm run setup
SECOND_MIGRATION_COUNT=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -Atc 'SELECT COUNT(*) FROM schema_migrations')
test "$FIRST_MIGRATION_COUNT" = "$SECOND_MIGRATION_COUNT"

echo '[5/10] Running lint, production build and API/unit tests'
npm run lint
npm run build
npm test

echo '[6/10] Running browser acceptance scenarios'
npm run test:e2e

echo '[7/10] Verifying API to SMTP to Mailpit flow'
npm run mail:check

if [ "${ACCEPTANCE_LIVE_PROVIDERS:-1}" = '1' ]; then
  echo '[8/10] Verifying live LiteAPI, Travelpayouts and OpenRouter credentials'
  PROVIDER_FIXTURES_ENABLED=false npm run providers:check
else
  echo '[8/10] Live provider checks skipped by ACCEPTANCE_LIVE_PROVIDERS=0'
fi

echo '[9/10] Creating and restoring a PostgreSQL custom-format backup'
docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -c "CREATE TABLE acceptance_restore_marker (value TEXT PRIMARY KEY); INSERT INTO acceptance_restore_marker VALUES ('restore-ok');"
docker compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --no-owner --no-acl --file="$BACKUP_FILE"
docker compose exec -T postgres dropdb -U "$DB_USER" --force "$DB_NAME"
docker compose exec -T postgres createdb -U "$DB_USER" "$DB_NAME"
docker compose exec -T postgres pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl "$BACKUP_FILE"
RESTORED_VALUE=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -Atc 'SELECT value FROM acceptance_restore_marker')
test "$RESTORED_VALUE" = 'restore-ok'

echo '[10/10] Re-checking schema after restore'
npm run setup
RESTORED_MIGRATION_COUNT=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -Atc 'SELECT COUNT(*) FROM schema_migrations')
test "$RESTORED_MIGRATION_COUNT" = "$FIRST_MIGRATION_COUNT"

echo "PASS Local MVP acceptance completed with ${FIRST_MIGRATION_COUNT} migrations and a verified backup restore."
