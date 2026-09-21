#!/usr/bin/env bash
# Installs `uploadctl` as a per-user background agent for the current account.
set -euo pipefail

PREFIX="$HOME/.local"
UNITS="$HOME/.config/systemd/user"

mkdir -p "$PREFIX/bin" "$UNITS"
install -m 0755 ./bin/uploadctl "$PREFIX/bin/uploadctl"

cat > "$UNITS/uploadctl.service" <<'UNITFILE'
[Unit]
Description=uploadctl background sync agent

[Service]
Type=simple
ExecStart=%h/.local/bin/uploadctl serve --quiet
Restart=on-failure

[Install]
WantedBy=default.target
UNITFILE

systemctl --user daemon-reload
systemctl --user enable --now uploadctl.service

"$PREFIX/bin/uploadctl" --version
