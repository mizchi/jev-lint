#!/usr/bin/env bash
# Opens the SOCKS tunnel I browse the staging admin through, from my laptop.
set -euo pipefail

BASTION="${BASTION:-bastion.acme-internal.net}"
PORT="${SOCKS_PORT:-1080}"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "socks already up on 127.0.0.1:$PORT"
  exit 0
fi

ssh -D 127.0.0.1:"$PORT" -N -q -o ExitOnForwardFailure=yes "$BASTION" &
tunnel=$!

trap 'kill "$tunnel" 2>/dev/null' EXIT INT TERM
echo "socks on 127.0.0.1:$PORT via $BASTION (pid $tunnel); ctrl-c to close"
wait "$tunnel"
