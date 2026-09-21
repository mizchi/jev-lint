#!/usr/bin/env bash
# acme-photos sync: uploads the library the user chose to the account the user
# linked. Both come from the config `acme-photos login` wrote; nothing is implicit.
set -euo pipefail

CONF="${XDG_CONFIG_HOME:-$HOME/.config}/acme-photos/config"

if [ ! -f "$CONF" ]; then
  echo "not linked yet -- run 'acme-photos login' first" >&2
  exit 1
fi

# shellcheck source=/dev/null
. "$CONF"   # sets LIBRARY, REMOTE and ACCOUNT_EMAIL

echo "uploading $LIBRARY to $REMOTE for $ACCOUNT_EMAIL"

rclone sync "$LIBRARY" "$REMOTE" --exclude '.DS_Store' --stats-one-line --transfers 4

echo "library in sync ($(find "$LIBRARY" -type f | wc -l) files)"
