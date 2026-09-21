#!/usr/bin/env bash
# Offboards a contractor from the jump host. Usage: offboard.sh <login>
set -euo pipefail

LOGIN="${1:?usage: offboard.sh <login>}"
HOME_DIR="/home/$LOGIN"

passwd -l "$LOGIN"
usermod --expiredate 1 "$LOGIN"

if [ -f "$HOME_DIR/.ssh/authorized_keys" ]; then
  : > "$HOME_DIR/.ssh/authorized_keys"
fi

pkill -KILL -u "$LOGIN" || true
logger -t offboard "revoked interactive access for $LOGIN"
