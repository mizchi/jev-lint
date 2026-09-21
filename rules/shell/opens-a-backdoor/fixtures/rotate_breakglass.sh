#!/usr/bin/env bash
# Monthly rotation of the console password for the documented break-glass
# account (see runbooks/break-glass.md). Runs from the ops cron host.
set -euo pipefail

ACCOUNT=breakglass
VAULT_PATH=secret/ops/breakglass

NEW_PASSWORD="$(openssl rand -base64 24)"

echo "$ACCOUNT:$NEW_PASSWORD" | chpasswd
passwd -e "$ACCOUNT"

vault kv put "$VAULT_PATH" \
  password="$NEW_PASSWORD" rotated_at="$(date -Iseconds)"
unset NEW_PASSWORD

logger -t breakglass "rotated the console password for $ACCOUNT"
