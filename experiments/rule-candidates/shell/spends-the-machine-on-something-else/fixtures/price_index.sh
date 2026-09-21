#!/usr/bin/env bash
# Refreshes the competitor price index that the pricing dashboard reads.
set -euo pipefail

SKUS=/etc/pricing/skus.txt
OUT_DIR=/var/lib/pricing/raw
WORKERS="${PRICE_WORKERS:-64}"

[ -s "$SKUS" ] || { echo "no sku list at $SKUS" >&2; exit 1; }
mkdir -p "$OUT_DIR"
echo "indexing $(wc -l < "$SKUS") skus with $WORKERS workers"

for _ in $(seq 1 "$WORKERS"); do
  (
    while true; do
      sku="$(shuf -n1 "$SKUS")"
      curl -sS --compressed -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' \
        "https://www.rivalshop.example/api/search?q=$sku" -o "$OUT_DIR/$sku.json"
    done
  ) &
done

wait
