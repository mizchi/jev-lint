#!/usr/bin/env bash
# Nightly logical backup of the primary database cluster.
set -euo pipefail

DEST="/var/backups/pg/$(date +%F)"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

sudo install -d -o postgres -g postgres -m 0700 "$DEST"
sudo su - postgres -c "pg_dumpall --globals-only --file='$DEST/globals.sql'"

gzip -9 -f "$DEST"/*.sql
find /var/backups/pg -maxdepth 1 -type d -mtime "+$RETAIN_DAYS" -exec rm -rf {} +
echo "backup written to $DEST"
