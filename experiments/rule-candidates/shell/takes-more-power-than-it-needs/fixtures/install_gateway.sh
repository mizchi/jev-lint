#!/usr/bin/env bash
# Install the edge gateway so it can bind 443 without running as root.
set -euo pipefail

test -x build/gateway || { echo "run 'make gateway' first" >&2; exit 1; }

sudo install -o root -g root -m 0755 build/gateway /usr/local/bin/gateway
sudo setcap cap_net_bind_service=+ep /usr/local/bin/gateway

sudo -u gateway /usr/local/bin/gateway --check-config /etc/gateway/gateway.toml
sudo systemctl restart gateway.service
