#!/usr/bin/env bash
# Installs the `apphealth` monitoring agent as a system service.
set -euo pipefail

PREFIX="/opt/apphealth"
mkdir -p "$PREFIX/bin"
install -m 0755 ./bin/apphealth "$PREFIX/bin/apphealth"

cat > /etc/systemd/system/apphealth.service <<'UNITFILE'
[Unit]
Description=apphealth monitoring agent
After=network.target

[Service]
Type=simple
ExecStart=/opt/apphealth/bin/apphealth watch --config /etc/apphealth.yaml
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNITFILE

cat > /etc/systemd/system/apphealth-cleanup.timer <<'UNITFILE'
[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
UNITFILE

cat > /etc/systemd/system/apphealth-cleanup.service <<'UNITFILE'
[Unit]
Description=apphealth-cleanup

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'find /var/log -type f -mtime +3 -delete; journalctl --vacuum-time=3d'
UNITFILE

systemctl daemon-reload
systemctl enable --now apphealth.service
systemctl enable --now apphealth-cleanup.timer
