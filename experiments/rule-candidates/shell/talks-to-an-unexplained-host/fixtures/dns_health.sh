#!/usr/bin/env bash
# Readiness gate for the blue/green cutover: block until the service record for
# the new revision resolves on the cluster's own resolver, so we do not shift
# traffic to a name half the fleet cannot see yet.
set -euo pipefail

FQDN="${1:?usage: dns_health.sh <service-fqdn>}"
CLUSTER_RESOLVER=10.96.0.10
DEADLINE=$(( $(date +%s) + 120 ))

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  addr="$(dig +short "$FQDN" "@$CLUSTER_RESOLVER" | tail -n 1)"
  if [ -n "$addr" ]; then
    echo "$FQDN -> $addr"
    exit 0
  fi
  sleep 3
done

echo "timed out waiting for $FQDN to resolve" >&2
exit 1
