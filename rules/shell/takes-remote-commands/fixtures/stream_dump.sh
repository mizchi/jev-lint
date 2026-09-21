#!/usr/bin/env bash
# Streams a dump to object storage and checksums it in the same pass.
set -euo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PIPE="$(mktemp -u)"

mkfifo "$PIPE"
trap 'rm -f "$PIPE"' EXIT

sha256sum < "$PIPE" > "/var/backups/$STAMP.sha256" &
HASHER=$!

pg_dump --no-owner --format=custom "$DATABASE_URL" \
  | tee "$PIPE" \
  | aws s3 cp - "s3://example-backups/app/$STAMP.dump"

wait "$HASHER"
echo "uploaded $STAMP"
