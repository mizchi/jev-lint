#!/bin/sh
# Prints the NAT egress address of this build agent so the platform team can
# keep the customers' firewall allowlists current. Run by hand after a pool is
# rebuilt, and from the pool's smoke test.
set -eu

if ! ping -c 1 -W 2 1.1.1.1 >/dev/null 2>&1; then
  echo "no route off this agent" >&2
  exit 1
fi

egress="$(curl -fsS -m 5 https://ifconfig.co/ip | tr -d '[:space:]')"

case "$egress" in
  '' | *[!0-9.]*) echo "unexpected answer from the echo service: $egress" >&2; exit 1 ;;
esac

printf 'agent=%s egress=%s\n' "$(hostname -s)" "$egress"
