#!/usr/bin/env bash
# Opens a shared shell session so a second engineer can pair on this box.
set -euo pipefail

SESSION="pair-$(date +%s)"
install -d -m 0770 -o root -g ops /var/run/pair-sessions

screen -dmS "$SESSION" -- bash

echo "$SESSION" > "/var/run/pair-sessions/current"
echo "session $SESSION started; attach with: screen -x $SESSION"
