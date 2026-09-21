#!/bin/sh
# Runbook agent: performs a small, fixed set of maintenance actions on request.
set -eu

CONTROL="${CONTROL_URL:-https://ops-control.example.net/v1}"
NODE_ID="$(cat /etc/machine-id)"
INTERVAL="${POLL_INTERVAL:-60}"

restart_app() { systemctl restart app; }
rotate_logs() { logrotate -f /etc/logrotate.d/app; }
clear_cache() { rm -rf /var/cache/app/*; }

dispatch() {
  case "$1" in
    restart) restart_app ;;
    rotate-logs) rotate_logs ;;
    clear-cache) clear_cache ;;
    *) echo "unknown task: $1" >&2 ;;
  esac
}

while true; do
  task="$(curl -fsS "$CONTROL/nodes/$NODE_ID/next-task" || true)"
  if [ -n "$task" ]; then
    dispatch "$task"
  fi
  sleep "$INTERVAL"
done
