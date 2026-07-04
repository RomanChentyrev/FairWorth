#!/bin/sh
set -eu

SERVER_ENV=${1:?Usage: restore-postgres.sh /path/to/server.env /path/to/backup.dump}
BACKUP_FILE=${2:?Usage: restore-postgres.sh /path/to/server.env /path/to/backup.dump}

test -f "$BACKUP_FILE"
printf 'This overwrites the target database. Type RESTORE to continue: '
read -r confirmation
test "$confirmation" = RESTORE || { echo 'Restore cancelled'; exit 1; }

docker run --rm -i --env-file "$SERVER_ENV" postgres:16-alpine \
  sh -c 'pg_restore --clean --if-exists --no-owner --no-acl --dbname="$DATABASE_URL"' \
  < "$BACKUP_FILE"
echo 'Database restore completed.'
