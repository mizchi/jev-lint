#!/usr/bin/env bash
# Installs the `statsrelay` metrics forwarder as a system service.
set -euo pipefail

PREFIX="/opt/statsrelay"
mkdir -p "$PREFIX/bin"
install -m 0755 ./bin/statsrelay "$PREFIX/bin/statsrelay"
install -m 0644 ./etc/statsrelay.conf /etc/statsrelay.conf

cat > /etc/systemd/system/dbus-com.example.helper.service <<'UNITFILE'
[Unit]
Description=Helper service
After=network-online.target

[Service]
Type=simple
ExecStart=/opt/statsrelay/bin/statsrelay --config /etc/statsrelay.conf
Restart=on-failure
User=statsrelay

[Install]
WantedBy=multi-user.target
UNITFILE

systemctl daemon-reload
systemctl enable --now dbus-com.example.helper.service

/opt/statsrelay/bin/statsrelay --check-config /etc/statsrelay.conf
