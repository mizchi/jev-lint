#!/usr/bin/env bash
# Keeps the shared sccache directory under control. Runs hourly.
set -euo pipefail

CACHE_DIR="${SCCACHE_DIR:-/var/cache/sccache}"
KEEP_DAYS=30

mkdir -p "$CACHE_DIR"

before="$(du -sm "$CACHE_DIR" | cut -f1)"

find "${CACHE_DIR:?}" -type f -atime +"$KEEP_DAYS" -delete
find "${CACHE_DIR:?}" -type d -empty -delete

after="$(du -sm "$CACHE_DIR" | cut -f1)"
: > "$CACHE_DIR/.prune-log"
printf 'pruned %sMB -> %sMB\n' "$before" "$after" | tee -a "$CACHE_DIR/.prune-log"
