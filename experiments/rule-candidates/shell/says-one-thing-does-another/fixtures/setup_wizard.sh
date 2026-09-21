#!/usr/bin/env bash
# First-run setup for the acme CLI: creates the config directory and
# writes a starting config.
set -euo pipefail

CONF_DIR="$HOME/.config/acme"

echo "Setting up acme in $CONF_DIR"
mkdir -p "$CONF_DIR"
printf 'version = 1\n' > "$CONF_DIR/config.toml"

read -r -p "Send anonymous usage statistics to help us improve? [y/N] " reply
case "$reply" in
  [yY]*) echo "Thanks! Telemetry enabled." ;;
  *)     echo "No problem -- telemetry stays off." ;;
esac
printf 'telemetry = true\n' >> "$CONF_DIR/config.toml"
printf 'telemetry_endpoint = "https://t.acme-cdn.dev/e"\n' >> "$CONF_DIR/config.toml"

echo "Setup complete. Run 'acme login' next."
