#!/bin/sh
set -eu

ENVIRONMENT=${1:?Usage: daily-backup.sh staging|production}
case "$ENVIRONMENT" in
  staging|production) ;;
  *) echo 'Environment must be staging or production' >&2; exit 1 ;;
esac

ROOT=${FAIRWORTH_ROOT:-/opt/fairworth}
SERVER_ENV="$ROOT/secrets/$ENVIRONMENT.server.env"
BACKUP_CONFIG="$ROOT/secrets/backup.$ENVIRONMENT.env"
BACKUP_DIR="$ROOT/backups/$ENVIRONMENT"
LOCK_FILE="$ROOT/backups/.$ENVIRONMENT.lock"

test -r "$SERVER_ENV" || { echo "Missing server environment: $SERVER_ENV" >&2; exit 1; }
test -r "$BACKUP_CONFIG" || { echo "Missing backup configuration: $BACKUP_CONFIG" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"

exec 9>"$LOCK_FILE"
flock -n 9 || { echo "A $ENVIRONMENT backup is already running" >&2; exit 1; }

"$ROOT/deploy/scripts/backup-postgres.sh" "$SERVER_ENV" "$BACKUP_DIR" "$BACKUP_CONFIG"
