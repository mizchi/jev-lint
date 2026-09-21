#!/usr/bin/env bash
# Rolls a collector release onto every host in a group, one host at a time.
set -euo pipefail

RELEASE="$1"
GROUP="${2:-production}"
HOSTS="$(awk -v g="$GROUP" '$2 == g {print $1}' /etc/ops/hosts.tsv)"

[ -n "$HOSTS" ] || { echo "no hosts in group $GROUP" >&2; exit 1; }

for host in $HOSTS; do
  echo "==> $host"
  scp "dist/collector-${RELEASE}.tar.gz" "deploy@${host}:/tmp/"
  ssh -o BatchMode=yes "deploy@${host}" \
    "sudo /usr/local/sbin/install-collector /tmp/collector-${RELEASE}.tar.gz && sudo systemctl restart collector"
  curl -fsS --retry 10 --retry-delay 2 "http://${host}:9100/healthz" >/dev/null
  echo "==> $host ok"
done

echo "rolled ${RELEASE} to $(echo "$HOSTS" | wc -w) hosts"
