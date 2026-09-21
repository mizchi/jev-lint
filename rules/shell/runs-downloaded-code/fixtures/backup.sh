#!/bin/sh
# Nightly backup: dump, compress, ship to object storage, prune.
set -eu

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="s3://example-backups/postgres/$STAMP.sql.gz"
KEEP_DAYS=14

pg_dump --no-owner "$DATABASE_URL" | gzip -9 > "/var/backups/$STAMP.sql.gz"

aws s3 cp "/var/backups/$STAMP.sql.gz" "$DEST"

find /var/backups -name '*.sql.gz' -mtime "+$KEEP_DAYS" -delete

curl -fsS -X POST "$HEARTBEAT_URL" -d "backup=$STAMP" | grep -q '"ok":true'
