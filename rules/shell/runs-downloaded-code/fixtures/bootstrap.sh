#!/usr/bin/env bash
# Sets up a fresh worker box: runtime, agent, then the service unit.
set -euo pipefail

RUNTIME_HOST="${RUNTIME_HOST:-https://get.runtime.example.com}"
AGENT_HOST="${AGENT_HOST:-https://cdn.opsagent.example.net}"

log() { printf '[bootstrap] %s\n' "$*" >&2; }

log "installing the runtime"
curl -fsSL "$RUNTIME_HOST/install.sh" | bash

log "installing the ops agent"
curl -fsSL "$AGENT_HOST/latest/agent-install" | sh -s -- --channel stable

log "registering the box"
curl -fsS -X POST "https://fleet.example.com/api/v1/hosts" \
  -H "Authorization: Bearer ${FLEET_TOKEN}" \
  -d "{\"hostname\":\"$(hostname)\"}"

log "done"
