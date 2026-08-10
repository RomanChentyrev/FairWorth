#!/bin/sh
set -eu

BACKUP_FILE=${1:?Usage: verify-backup-restore.sh /path/to/backup.dump}
CONTAINER="fairworth-backup-restore-$$"
PASSWORD="restore-drill-$$"

test -r "$BACKUP_FILE"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

docker run -d --name "$CONTAINER" \
  -e POSTGRES_DB=fairworth_restore_test \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD="$PASSWORD" \
  postgres:16-alpine >/dev/null

attempt=0
until docker exec "$CONTAINER" pg_isready -U postgres -d fairworth_restore_test >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 30 || { echo 'Temporary PostgreSQL did not become ready' >&2; exit 1; }
  sleep 1
done

docker exec -i "$CONTAINER" \
  pg_restore -U postgres -d fairworth_restore_test --no-owner --no-acl \
  < "$BACKUP_FILE"

docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d fairworth_restore_test \
  -c "SELECT COUNT(*) AS public_tables FROM pg_tables WHERE schemaname = 'public';" \
  -c 'SELECT COUNT(*) AS applied_migrations FROM schema_migrations;'

trap - EXIT HUP INT TERM
cleanup
echo "Backup restore drill passed: $BACKUP_FILE"
