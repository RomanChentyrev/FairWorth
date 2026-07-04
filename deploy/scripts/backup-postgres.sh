#!/bin/sh
set -eu

SERVER_ENV=${1:?Usage: backup-postgres.sh /path/to/server.env [backup-directory]}
BACKUP_DIR=${2:-/opt/fairworth/backups}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)

mkdir -p "$BACKUP_DIR"
umask 077
docker run --rm --env-file "$SERVER_ENV" postgres:16-alpine \
  sh -c 'pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL"' \
  > "$BACKUP_DIR/fairworth-$TIMESTAMP.dump"

test -s "$BACKUP_DIR/fairworth-$TIMESTAMP.dump"
find "$BACKUP_DIR" -type f -name 'fairworth-*.dump' -mtime "+$RETENTION_DAYS" -delete
echo "Backup created: $BACKUP_DIR/fairworth-$TIMESTAMP.dump"
