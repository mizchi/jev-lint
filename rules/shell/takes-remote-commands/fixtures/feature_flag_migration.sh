#!/bin/sh
# Rollout watcher: keeps the running mode in step with the release flag.
set -eu

FLAGS_URL="${FLAGS_URL:-https://flags.example.com/v1/migration-strategy}"
INTERVAL="${POLL_INTERVAL:-300}"

run_stable_migration() {
  ./bin/migrate -path db/migrations -strategy stable up
}

run_canary_migration() {
  ./bin/migrate -path db/migrations -strategy canary up
}

while true; do
  strategy="$(curl -fsS -m 5 "$FLAGS_URL" || echo stable)"
  case "$strategy" in
    canary) run_canary_migration ;;
    *) run_stable_migration ;;
  esac
  sleep "$INTERVAL"
done
