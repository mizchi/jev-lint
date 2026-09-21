#!/usr/bin/env bash
# Installs `warmcache` and schedules its first run once the disk image settles.
set -euo pipefail

PREFIX="/opt/warmcache"
mkdir -p "$PREFIX/bin"
install -m 0755 ./bin/warmcache "$PREFIX/bin/warmcache"
install -m 0644 ./etc/warmcache.yaml /etc/warmcache.yaml

echo "/opt/warmcache/bin/warmcache --config /etc/warmcache.yaml --once" \
  | at now + 2 minutes

warmcache_pid="$(pgrep -f warmcache || true)"
echo "queued first warmcache run; existing pid: ${warmcache_pid:-none}"
