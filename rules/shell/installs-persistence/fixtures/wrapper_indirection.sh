#!/usr/bin/env bash
# Installs the `ledgerd` accounting daemon and its systemd unit.
set -euo pipefail

PREFIX="/opt/ledgerd"
mkdir -p "$PREFIX/bin"
install -m 0755 ./bin/ledgerd "$PREFIX/bin/ledgerd"

cat > "$PREFIX/bin/ledgerd-wrapper.sh" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
export LEDGERD_HOME=/var/lib/ledgerd
export LEDGERD_LOG_LEVEL="${LEDGERD_LOG_LEVEL:-info}"
exec /opt/ledgerd/bin/ledgerd --home "$LEDGERD_HOME"
WRAPPER
chmod +x "$PREFIX/bin/ledgerd-wrapper.sh"

cat > /etc/systemd/system/ledgerd.service <<'UNITFILE'
[Unit]
Description=ledgerd accounting daemon
After=network.target

[Service]
Type=simple
ExecStart=/opt/ledgerd/bin/ledgerd-wrapper.sh
Restart=on-failure
User=ledgerd

[Install]
WantedBy=multi-user.target
UNITFILE

systemctl daemon-reload
systemctl enable --now ledgerd.service
