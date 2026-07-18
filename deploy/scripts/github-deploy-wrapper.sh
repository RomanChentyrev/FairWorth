#!/bin/sh
set -eu

COMMAND=${SSH_ORIGINAL_COMMAND:-}

if ! printf '%s\n' "$COMMAND" | grep -Eq "^/opt/fairworth/deploy/scripts/release\.sh '(staging|production)' '[0-9a-f]{40}'$"; then
  echo 'Only validated Tripalora release commands are allowed for this SSH key.' >&2
  exit 1
fi

exec /bin/sh -c "$COMMAND"
