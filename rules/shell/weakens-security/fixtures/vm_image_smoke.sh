#!/usr/bin/env bash
# Boots a throwaway VM to check the cloud-init image still comes up, then destroys it.
set -euo pipefail

NAME="smoke-$RANDOM"
trap 'multipass delete --purge "$NAME" >/dev/null 2>&1 || true' EXIT

multipass launch 24.04 --name "$NAME" --cloud-init ci/cloud-init.yaml
IP="$(multipass info "$NAME" --format json | jq -r ".info[\"$NAME\"].ipv4[0]")"

ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -i ci/smoke_key ubuntu@"$IP" 'systemctl is-active node-exporter'

ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -i ci/smoke_key ubuntu@"$IP" 'test -f /etc/app/config.toml'

echo "image smoke passed on $NAME"
