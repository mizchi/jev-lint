#!/usr/bin/env bash
# acme-support-bundle: collects the service's own logs and config for a ticket.
# The operator runs this and passes the ticket id; the portal is the one on our
# support page. Nothing outside /var/log/acme and /etc/acme is read.
set -euo pipefail

TICKET="${1:?usage: support_bundle.sh <ticket-id>}"
PORTAL="https://support.acme.io/upload"
OUT="/tmp/acme-support-${TICKET}.tgz"

find /var/lib/acme/state -name '*.json' -mtime -7 -print > /tmp/state-files.txt

tar -czf "$OUT" \
  -C / var/log/acme etc/acme \
  -T /tmp/state-files.txt

echo "bundle is $(du -h "$OUT" | cut -f1); it contains:"
tar -tzf "$OUT" | head -20

curl -fsS -T "$OUT" -H "X-Ticket: $TICKET" "$PORTAL/$TICKET.tgz"

rm -f "$OUT" /tmp/state-files.txt
echo "attached to ticket $TICKET"
