#!/bin/sh
set -eu

SERVER_ENV=${1:?Usage: backup-postgres.sh /path/to/server.env [backup-directory] [backup-config]}
BACKUP_DIR=${2:-/opt/fairworth/backups}
BACKUP_CONFIG=${3:-}
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILENAME="fairworth-$TIMESTAMP.dump"
FINAL_FILE="$BACKUP_DIR/$FILENAME"
TEMP_FILE="$BACKUP_DIR/.$FILENAME.tmp"

config_value() {
  key=$1
  test -n "$BACKUP_CONFIG" && test -f "$BACKUP_CONFIG" || return 0
  sed -n "s/^${key}=//p" "$BACKUP_CONFIG" | tail -n 1 | tr -d '\r'
}

positive_days() {
  case "$1" in
    ''|*[!0-9]*|0) return 1 ;;
    *) return 0 ;;
  esac
}

RETENTION_DAYS=$(config_value BACKUP_RETENTION_DAYS)
RETENTION_DAYS=${RETENTION_DAYS:-${BACKUP_RETENTION_DAYS:-14}}
positive_days "$RETENTION_DAYS" || { echo 'BACKUP_RETENTION_DAYS must be a positive integer' >&2; exit 1; }

umask 077
mkdir -p "$BACKUP_DIR"
trap 'rm -f "$TEMP_FILE"' EXIT HUP INT TERM
docker run --rm --env-file "$SERVER_ENV" postgres:16-alpine \
  sh -c 'pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL"' \
  > "$TEMP_FILE"

test -s "$TEMP_FILE"
docker run --rm -v "$BACKUP_DIR:/backups:ro" postgres:16-alpine \
  pg_restore --list "/backups/.$FILENAME.tmp" >/dev/null
mv "$TEMP_FILE" "$FINAL_FILE"

S3_ENABLED=$(config_value BACKUP_S3_ENABLED)
if test "$S3_ENABLED" = true; then
  command -v rclone >/dev/null 2>&1 || { echo 'rclone is required for object-storage backups' >&2; exit 1; }
  S3_BUCKET=$(config_value BACKUP_S3_BUCKET)
  S3_PREFIX=$(config_value BACKUP_S3_PREFIX)
  S3_ENDPOINT=$(config_value BACKUP_S3_ENDPOINT)
  S3_REGION=$(config_value BACKUP_S3_REGION)
  S3_PROVIDER=$(config_value BACKUP_S3_PROVIDER)
  S3_ACCESS_KEY_ID=$(config_value BACKUP_S3_ACCESS_KEY_ID)
  S3_SECRET_ACCESS_KEY=$(config_value BACKUP_S3_SECRET_ACCESS_KEY)
  REMOTE_RETENTION_DAYS=$(config_value BACKUP_REMOTE_RETENTION_DAYS)
  S3_PROVIDER=${S3_PROVIDER:-Other}
  S3_REGION=${S3_REGION:-auto}
  S3_PREFIX=${S3_PREFIX#/}
  S3_PREFIX=${S3_PREFIX%/}
  REMOTE_RETENTION_DAYS=${REMOTE_RETENTION_DAYS:-90}

  test -n "$S3_BUCKET" || { echo 'BACKUP_S3_BUCKET is required' >&2; exit 1; }
  test -n "$S3_PREFIX" || { echo 'BACKUP_S3_PREFIX is required' >&2; exit 1; }
  test -n "$S3_ACCESS_KEY_ID" || { echo 'BACKUP_S3_ACCESS_KEY_ID is required' >&2; exit 1; }
  test -n "$S3_SECRET_ACCESS_KEY" || { echo 'BACKUP_S3_SECRET_ACCESS_KEY is required' >&2; exit 1; }
  positive_days "$REMOTE_RETENTION_DAYS" || { echo 'BACKUP_REMOTE_RETENTION_DAYS must be a positive integer' >&2; exit 1; }

  export RCLONE_CONFIG_TRIPALORABACKUPS_TYPE=s3
  export RCLONE_CONFIG_TRIPALORABACKUPS_PROVIDER="$S3_PROVIDER"
  export RCLONE_CONFIG_TRIPALORABACKUPS_REGION="$S3_REGION"
  export RCLONE_CONFIG_TRIPALORABACKUPS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
  export RCLONE_CONFIG_TRIPALORABACKUPS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_TRIPALORABACKUPS_ACL=private
  if test -n "$S3_ENDPOINT"; then
    export RCLONE_CONFIG_TRIPALORABACKUPS_ENDPOINT="$S3_ENDPOINT"
  fi

  REMOTE_DIR="tripalorabackups:$S3_BUCKET/$S3_PREFIX"
  rclone copyto "$FINAL_FILE" "$REMOTE_DIR/$FILENAME" \
    --transfers 1 --checkers 4 --s3-no-check-bucket
  rclone delete "$REMOTE_DIR" --include 'fairworth-*.dump' \
    --min-age "${REMOTE_RETENTION_DAYS}d" --s3-no-check-bucket
  echo "Backup uploaded: $REMOTE_DIR/$FILENAME"
fi

find "$BACKUP_DIR" -type f -name 'fairworth-*.dump' -mtime "+$RETENTION_DAYS" -delete
trap - EXIT HUP INT TERM
echo "Backup created: $FINAL_FILE"
