#!/bin/sh
# Blocks until the freshly started API answers. Used by the compose healthcheck.
set -eu

URL="${API_URL:-http://localhost:8080}"
DEADLINE=$(( $(date +%s) + 120 ))

until curl -fsS --max-time 2 "$URL/healthz" 2>/dev/null | grep -q '"status":"ok"'; do
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "api did not become healthy within 120s" >&2
    exit 1
  fi
  sleep 2
done

curl -fsS "$URL/version" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'
echo "api is up"
