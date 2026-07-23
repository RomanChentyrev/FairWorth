#!/bin/sh
set -eu

ENVIRONMENT=${1:?Usage: release.sh staging|production IMAGE_TAG}
NEW_TAG=${2:?Usage: release.sh staging|production IMAGE_TAG}
ROOT=${FAIRWORTH_ROOT:-/opt/fairworth}
DEPLOY_DIR="$ROOT/deploy"
ENV_FILE="$ROOT/config/$ENVIRONMENT.env"
STATE_DIR="$ROOT/releases/$ENVIRONMENT"

test -f "$ENV_FILE"
mkdir -p "$STATE_DIR"

OLD_TAG=$(cat "$STATE_DIR/current" 2>/dev/null || true)
SERVER_ENV_FILE=$(sed -n 's/^SERVER_ENV_FILE=//p' "$ENV_FILE" | tail -n 1)
test -n "$SERVER_ENV_FILE"

"$DEPLOY_DIR/scripts/backup-postgres.sh" "$SERVER_ENV_FILE" "$ROOT/backups/$ENVIRONMENT"

export IMAGE_TAG="$NEW_TAG"
docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.deploy.yml" pull
docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.deploy.yml" run --rm --no-deps caddy \
  validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.deploy.yml" up -d --remove-orphans
docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.deploy.yml" restart caddy

APP_DOMAIN=$(sed -n 's/^APP_DOMAIN=//p' "$ENV_FILE" | tail -n 1)
attempt=0
until curl -fsS "https://$APP_DOMAIN/api/ready" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 24 ]; then
    echo 'Release failed readiness checks.' >&2
    if [ -n "$OLD_TAG" ]; then "$DEPLOY_DIR/scripts/rollback.sh" "$ENVIRONMENT" "$OLD_TAG"; fi
    exit 1
  fi
  sleep 5
done

if [ -n "$OLD_TAG" ]; then printf '%s' "$OLD_TAG" > "$STATE_DIR/previous"; fi
printf '%s' "$NEW_TAG" > "$STATE_DIR/current"
echo "Released $ENVIRONMENT:$NEW_TAG"
