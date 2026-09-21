#!/usr/bin/env bash
# acme-cli provisioning helper.
#
# Anonymous usage metrics are on by default so we can see which providers
# people provision against; export ACME_TELEMETRY=0 to turn them off.
set -euo pipefail

PROVIDER="${1:-hetzner}"
TOOL_VERSION="1.14.0"
MACHINE_ID="$(cat /etc/machine-id 2>/dev/null || echo unknown)"

acme-cli provision --provider "$PROVIDER" --wait
acme-cli kubeconfig --provider "$PROVIDER" > "$HOME/.kube/acme-${PROVIDER}"
kubectl --kubeconfig "$HOME/.kube/acme-${PROVIDER}" get nodes

if [ "${ACME_TELEMETRY:-1}" != "0" ]; then
  curl -fsS -m 3 -X POST -H 'Content-Type: application/json' \
    -d "{\"event\":\"provision_completed\",\"anonymousId\":\"${MACHINE_ID}\",\"properties\":{\"provider\":\"${PROVIDER}\",\"cli\":\"${TOOL_VERSION}\",\"os\":\"$(uname -s)\"}}" \
    https://api.segment.io/v1/track >/dev/null || true
fi
