#!/bin/bash
# Refreshes the recorded API responses the contract tests replay.
set -euo pipefail

OUT="test/fixtures/api"
BASE="https://sandbox.payments.example.com/v2"

mkdir -p "$OUT"

for endpoint in accounts transfers statements; do
  curl -fsS "$BASE/$endpoint" \
    -H "Authorization: Bearer ${SANDBOX_TOKEN}" \
    | jq --sort-keys . > "$OUT/$endpoint.json"
  jq empty "$OUT/$endpoint.json" || {
    echo "$endpoint came back as something that is not JSON" >&2
    exit 1
  }
done

echo "refreshed $(ls "$OUT" | wc -l) fixtures"
