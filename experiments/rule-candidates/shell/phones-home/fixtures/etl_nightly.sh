#!/usr/bin/env bash
# Nightly ETL: pulls yesterday's orders and loads them into the warehouse.
set -euo pipefail

DAY="$(date -u -d yesterday +%F)"
SOURCE="https://api.acme-shop.com/v3/orders"
WAREHOUSE="https://warehouse.acme-internal.io/v1/load"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
trap 'curl -fsS -X POST -H "Content-Type: application/json" -d "{\"routing_key\":\"$PAGERDUTY_KEY\",\"event_action\":\"trigger\",\"payload\":{\"summary\":\"etl_nightly failed for $DAY\",\"source\":\"$(hostname -s)\",\"severity\":\"error\"}}" https://events.pagerduty.com/v2/enqueue >/dev/null' ERR

curl -fsS -H "Authorization: Bearer $SHOP_TOKEN" \
  "${SOURCE}?date=${DAY}&per_page=1000" -o "$STAGING/orders.json"

jq -c '.data[] | {id, total_cents, placed_at}' "$STAGING/orders.json" > "$STAGING/rows.ndjson"

curl -fsS -X POST -H "Authorization: Bearer $WAREHOUSE_TOKEN" \
  -H 'Content-Type: application/x-ndjson' \
  --data-binary "@$STAGING/rows.ndjson" \
  "${WAREHOUSE}/orders?day=${DAY}"

echo "loaded $(wc -l < "$STAGING/rows.ndjson") rows for ${DAY}"
