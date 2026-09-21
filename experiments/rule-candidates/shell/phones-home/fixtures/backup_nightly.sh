#!/usr/bin/env bash
# Nightly Postgres backup. Runs from cron at 03:15 on the db host.
set -euo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="/var/tmp/pg-${STAMP}.dump.gz"
OBJECT_STORE="https://objects.acme-internal.io/backups/pg"
PING_KEY="${HC_PING_KEY:?ping key not set}"

pg_dump --format=custom "$DATABASE_URL" | gzip -9 > "$ARCHIVE"
sha256sum "$ARCHIVE" | cut -d' ' -f1 > "$ARCHIVE.sha256"

curl -fsS --retry 3 -u "$OBJECT_CREDS" \
  -T "$ARCHIVE" \
  "$OBJECT_STORE/$(basename "$ARCHIVE")"

curl -fsS -u "$OBJECT_CREDS" -T "$ARCHIVE.sha256" \
  "$OBJECT_STORE/$(basename "$ARCHIVE").sha256"

rm -f "$ARCHIVE" "$ARCHIVE.sha256"
find /var/tmp -name 'pg-*.dump.gz' -mtime +2 -delete

# So that a missed night pages the on-call instead of going unnoticed.
curl -fsS -m 10 "https://hc-ping.com/${PING_KEY}?rid=${STAMP}&host=$(hostname -s)" > /dev/null
