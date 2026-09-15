#!/bin/sh
# Patch the proxy's hardcoded OAuth redirect_uri to the externally reachable
# URL (localhost locally, https://<service>.up.railway.app in the cloud).
# Without this, Google redirects back to a host that isn't listening.
set -e

TARGET="/app/src/utils/headers.ts"
EXTERNAL_URL="${EXTERNAL_URL:-http://localhost:3000}"
EXTERNAL_URL="${EXTERNAL_URL%/}"   # trim trailing slash

if [ -f "$TARGET" ]; then
  sed -i "s|redirectUri: \"http://localhost:3000/oauth-callback\"|redirectUri: \"${EXTERNAL_URL}/oauth-callback\"|" "$TARGET"
  echo "[entrypoint] OAuth redirect_uri → ${EXTERNAL_URL}/oauth-callback"
else
  echo "[entrypoint] WARN: $TARGET not found — redirect_uri left unpatched"
fi

exec "$@"
