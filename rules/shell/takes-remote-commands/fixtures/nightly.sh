#!/bin/sh
# Cron entry: runs the long nightly chores detached so an operator can attach.
set -eu

SESSION="nightly-$(date +%F)"
LOG="/var/log/nightly"

mkdir -p "$LOG"

if pgrep -f 'SCREEN -dmS nightly-' >/dev/null 2>&1; then
  echo "a nightly session is already running" >&2
  exit 0
fi

screen -dmS "$SESSION" -L -Logfile "$LOG/$SESSION.log" \
  /usr/local/sbin/nightly-chores.sh --backup --prune --verify

echo "started $SESSION"
