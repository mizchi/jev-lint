#!/usr/bin/env bash
# Checks that this host can reach everything the service needs before it starts.
set -uo pipefail

DEPS="db-primary.internal:5432 cache.internal:6379 kafka-0.internal:9092"
failed=0

for dep in $DEPS; do
  host="${dep%%:*}"
  port="${dep##*:}"
  if nc -z -w 3 "$host" "$port" 2>/dev/null; then
    printf 'ok    %s\n' "$dep"
  else
    printf 'FAIL  %s\n' "$dep"
    failed=$(( failed + 1 ))
  fi
done

[ "$failed" -eq 0 ] || { echo "$failed dependencies unreachable" >&2; exit 1; }
echo "preflight passed"
