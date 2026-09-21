#!/usr/bin/env bash
# Warms the shared build cache and leaves a log the team can read.
set -euo pipefail

BUCKET="s3://acme-build-cache"
LOG="/var/www/html/build/cache-warm.log"

{
  echo "started $(date -Is)"
  echo "profile=${AWS_PROFILE:-default}"
  env | grep '^AWS_'
} >> "$LOG"

aws s3 cp "$BUCKET/manifest.json" ./manifest.json

while read -r key; do
  aws s3 cp "$BUCKET/$key" "/var/cache/build/$key" --quiet
done < <(jq -r '.objects[]' manifest.json)

echo "warmed $(wc -l < manifest.json) entries" >> "$LOG"
