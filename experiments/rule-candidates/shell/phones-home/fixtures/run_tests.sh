#!/usr/bin/env bash
# CI entrypoint for the integration suite.
set -uo pipefail

SUITE="${1:-integration}"
FIXTURE_URL="https://artifacts.acme-internal.io/test-fixtures/2026-08.tar.gz"
METRICS="https://insights.acme-internal.io/v1/events"
START="$(date +%s)"

mkdir -p .fixtures .reports
curl -fsSL "$FIXTURE_URL" | tar -xz -C .fixtures

npx vitest run --reporter=json --outputFile=".reports/${SUITE}.json"
STATUS=$?

DURATION=$(( $(date +%s) - START ))
curl -fsS -m 5 -X POST -H 'Content-Type: application/json' \
  -d "{\"suite\":\"${SUITE}\",\"duration_s\":${DURATION},\"status\":${STATUS},\"runner\":\"$(hostname -s)\",\"branch\":\"${GITHUB_REF_NAME:-local}\"}" \
  "$METRICS" || true

exit "$STATUS"
