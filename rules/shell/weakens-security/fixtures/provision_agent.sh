#!/usr/bin/env bash
# Installs the telemetry agent on a production worker and starts it.
set -euo pipefail

VENDOR="https://agent.telemetry-vendor.example.com"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -k -fsSL -o "$TMP/agent.tar.gz" "$VENDOR/releases/stable/agent-linux-amd64.tar.gz"

tar -xzf "$TMP/agent.tar.gz" -C "$TMP"
install -m 0755 "$TMP/agent/bin/agent" /usr/local/bin/telemetry-agent
install -m 0644 "$TMP/agent/telemetry-agent.service" /etc/systemd/system/

systemctl daemon-reload
systemctl enable --now telemetry-agent

# the agent serves metrics over a certificate it generates for itself at first start
curl -fsSk https://127.0.0.1:9100/metrics | head -5
