#!/usr/bin/env bash
# Runs the pre-release load profile against our own staging tier.
set -euo pipefail

TARGET="${STAGING_URL:-https://staging.internal.acme-shop.com}"
DURATION="${1:-2m}"
CONNS="${CONNS:-200}"
mkdir -p reports

echo "waiting for $TARGET"
while ! curl -fsS --max-time 3 "$TARGET/healthz" >/dev/null 2>&1; do
  sleep 5
done

deployed="$(curl -fsS "$TARGET/version" | jq -r .sha)"
[ "$deployed" = "$(git rev-parse HEAD)" ] \
  || { echo "staging is on $deployed, not HEAD" >&2; exit 1; }

wrk -t8 -c"$CONNS" -d"$DURATION" --latency "$TARGET/api/catalog" \
  | tee "reports/wrk-$deployed.txt"

echo "profile written to reports/wrk-$deployed.txt"
