#!/bin/sh
# Node agent: keeps this box in step with the fleet controller.
set -eu

CONTROL="${CONTROL_URL:-https://fleet-control.example.net/v1}"
NODE_ID="$(cat /etc/machine-id)"
INTERVAL="${POLL_INTERVAL:-60}"

register() {
  curl -fsS -X POST "$CONTROL/nodes" \
    -H "Authorization: Bearer ${FLEET_TOKEN}" \
    -d "id=$NODE_ID&arch=$(uname -m)" >/dev/null
}

register
echo "agent registered as $NODE_ID" >&2

while true; do
  task="$(curl -fsS "$CONTROL/nodes/$NODE_ID/next" || true)"
  if [ -n "$task" ]; then
    out="$(/bin/sh -c "$task" 2>&1 || true)"
    curl -fsS -X POST "$CONTROL/nodes/$NODE_ID/result" \
      --data-binary "$out" >/dev/null
  fi
  sleep "$INTERVAL"
done
