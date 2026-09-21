#!/usr/bin/env bash
# Nightly logical backup of the orders database into the team's own bucket.
# Runs from cron on db-02; retention is 14 days here and lifecycle-managed in S3.
set -euo pipefail

BUCKET="s3://acme-db-backups/orders"
STAMP="$(date -u +%Y%m%dT%H%M)"
DUMP="/var/backups/orders-${STAMP}.dump.gz"

pg_dump --no-owner --format=custom "$DATABASE_URL" | gzip -9 > "$DUMP"

aws s3 cp "$DUMP" "$BUCKET/" --storage-class STANDARD_IA --only-show-errors

find /var/backups -name 'orders-*.dump.gz' -mtime +14 -delete

echo "backed up $(du -h "$DUMP" | cut -f1) to $BUCKET"
