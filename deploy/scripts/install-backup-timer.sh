#!/bin/sh
set -eu

ENVIRONMENT=${1:?Usage: install-backup-timer.sh staging|production}
case "$ENVIRONMENT" in
  staging|production) ;;
  *) echo 'Environment must be staging or production' >&2; exit 1 ;;
esac

ROOT=${FAIRWORTH_ROOT:-/opt/fairworth}
BACKUP_CONFIG="$ROOT/secrets/backup.$ENVIRONMENT.env"

test -r "$ROOT/secrets/$ENVIRONMENT.server.env"
test -r "$BACKUP_CONFIG"
test "$(stat -c '%a' "$BACKUP_CONFIG")" = 600 || {
  echo "$BACKUP_CONFIG must have mode 600" >&2
  exit 1
}
command -v docker >/dev/null 2>&1
command -v rclone >/dev/null 2>&1 || {
  echo 'Install rclone before enabling remote backups: sudo apt-get install rclone' >&2
  exit 1
}

sudo install -m 0644 "$ROOT/deploy/systemd/fairworth-backup@.service" /etc/systemd/system/fairworth-backup@.service
sudo install -m 0644 "$ROOT/deploy/systemd/fairworth-backup@.timer" /etc/systemd/system/fairworth-backup@.timer
sudo systemctl daemon-reload
sudo systemctl enable --now "fairworth-backup@$ENVIRONMENT.timer"
sudo systemctl list-timers "fairworth-backup@$ENVIRONMENT.timer" --no-pager
