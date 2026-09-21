#!/usr/bin/env bash
# Nightly backup of the TLS material the edge nodes serve with.
set -euo pipefail

STAMP="$(date +%Y%m%d)"
ARCHIVE="/var/backups/tls-${STAMP}.tar.gz.gpg"
RECIPIENT="ops@acme.internal"
VAULT="backup@vault.acme.internal:/srv/backups/tls"

tar -czf - /etc/ssl/private /etc/ssl/certs \
  | gpg --batch --yes --encrypt --recipient "$RECIPIENT" --output "$ARCHIVE"

chmod 600 "$ARCHIVE"

scp -q "$ARCHIVE" "$VAULT/"

find /var/backups -name 'tls-*.tar.gz.gpg' -mtime +30 -delete
echo "backed up $ARCHIVE"
