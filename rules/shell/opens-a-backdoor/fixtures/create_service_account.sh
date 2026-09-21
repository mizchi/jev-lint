#!/usr/bin/env bash
# Creates the unprivileged account the metrics exporter runs as.
set -euo pipefail

EXPORTER=node-exporter
TEXTFILE_DIR=/var/lib/node_exporter/textfile

if ! getent passwd "$EXPORTER" >/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$EXPORTER"
fi

install -d -m 0755 -o "$EXPORTER" -g "$EXPORTER" "$TEXTFILE_DIR"

cat > /etc/sudoers.d/40-node-exporter <<'SUDO'
node-exporter ALL=(root) NOPASSWD: /usr/sbin/smartctl --json -a /dev/sda
SUDO
visudo -c -f /etc/sudoers.d/40-node-exporter
chmod 0440 /etc/sudoers.d/40-node-exporter

systemctl enable --now node_exporter.service
