#!/usr/bin/env bash
# Reindexes the documentation corpus into the search cluster.
set -euo pipefail

ES="${SEARCH_ENDPOINT:-http://search.internal:9200}"
BULK="$(mktemp)"
trap 'rm -f "$BULK"' EXIT

curl -fsS "${ES}/_cluster/health?wait_for_status=yellow&timeout=30s" > /dev/null

node ./scripts/build-bulk-ndjson.mjs docs/ > "$BULK"
wc -l "$BULK"

curl -fsS -X POST -H 'Content-Type: application/x-ndjson' \
  --data-binary "@${BULK}" \
  "${ES}/docs/_bulk?refresh=wait_for" | jq -r '.errors'

curl -fsS -X POST -H 'Content-Type: application/json' \
  -d '{"query":{"match":{"title":"install"}},"size":1}' \
  "${ES}/docs/_search" | jq -r '.hits.total.value'
