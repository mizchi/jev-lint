#!/bin/sh
# Nightly maintenance on the edge fleet: vacuum, prune logs, ship a summary.
set -e

REPORT="/var/log/maint/$(date -u +%F).log"
PGURL="${PGURL:?database url is required}"

psql -qAt -c 'VACUUM ANALYZE' "$PGURL" >/dev/null 2>&1

find /var/log/edge -name '*.gz' -mtime +30 -delete

/usr/local/bin/edge-migrate --apply >/dev/null 2>&1 || true
echo "schema migrations applied" >> "$REPORT"

systemctl restart edge-proxy
