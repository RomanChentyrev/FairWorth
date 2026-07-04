#!/bin/sh
set -eu

ENVIRONMENT=${1:?Usage: rollback.sh staging|production [IMAGE_TAG]}
ROOT=${FAIRWORTH_ROOT:-/opt/fairworth}
ENV_FILE="$ROOT/config/$ENVIRONMENT.env"
STATE_DIR="$ROOT/releases/$ENVIRONMENT"
ROLLBACK_TAG=${2:-$(cat "$STATE_DIR/previous" 2>/dev/null || true)}

test -n "$ROLLBACK_TAG" || { echo 'No previous image tag recorded.' >&2; exit 1; }
export IMAGE_TAG="$ROLLBACK_TAG"
docker compose --env-file "$ENV_FILE" -f "$ROOT/deploy/docker-compose.deploy.yml" pull web api
docker compose --env-file "$ENV_FILE" -f "$ROOT/deploy/docker-compose.deploy.yml" up -d --no-deps web api
printf '%s' "$ROLLBACK_TAG" > "$STATE_DIR/current"
echo "Rolled $ENVIRONMENT application images back to $ROLLBACK_TAG"
echo 'Database migrations are forward-only. Restore a verified backup only when the rollback runbook requires it.'
