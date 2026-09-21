#!/bin/sh
# Removes the ops agent and everything the installer put on the box.
set -e

PREFIX="$INSTALL_PREFIX"
UNIT=/etc/systemd/system/opsagent.service

if [ -f "$UNIT" ]; then
  systemctl stop opsagent 2>/dev/null || true
  systemctl disable opsagent 2>/dev/null || true
  rm -f "$UNIT"
  systemctl daemon-reload
fi

echo "removing $PREFIX"
rm -rf "$PREFIX/"

userdel opsagent 2>/dev/null || true
echo "opsagent removed"
