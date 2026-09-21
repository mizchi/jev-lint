#!/usr/bin/env bash
# Cron job on the shared build box: free space when /build gets tight.
set -euo pipefail

THRESHOLD=85
used="$(df --output=pcent /build | tail -1 | tr -dc '0-9')"

if [ "$used" -lt "$THRESHOLD" ]; then
  echo "/build at ${used}%, nothing to do"
  exit 0
fi

echo "/build at ${used}%, reclaiming"

docker system prune -af --volumes

find /home -maxdepth 3 -type d -name node_modules -exec rm -rf {} +

df -h /build
