#!/usr/bin/env bash
# Install the node metrics agent from the release tarball built by CI.
set -euo pipefail

VERSION="${VERSION:-1.8.2}"
TARBALL="dist/metrics-agent-${VERSION}.tar.gz"
[ -f "$TARBALL" ] || { echo "missing $TARBALL" >&2; exit 1; }

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
tar -xzf "$TARBALL" -C "$WORKDIR"

sudo install -o root -g root -m 0755 "$WORKDIR/metrics-agent" /usr/local/bin/metrics-agent
sudo install -o root -g root -m 0644 "$WORKDIR/metrics-agent.service" /etc/systemd/system/metrics-agent.service

sudo chmod 4755 /usr/local/bin/metrics-agent

sudo systemctl daemon-reload
sudo systemctl enable --now metrics-agent.service
systemctl --no-pager --quiet is-active metrics-agent.service
