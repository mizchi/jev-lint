#!/usr/bin/env bash
# Nagios check: is the primary's Postgres port answering from this subnet?
set -euo pipefail

HOST="${1:-db-primary.internal.acme.net}"
PORT=5432

if ! getent hosts "$HOST" >/dev/null; then
  echo "CRITICAL - $HOST does not resolve"
  exit 2
fi

state="$(nmap -Pn -n -p "$PORT" --host-timeout 5s "$HOST" \
  | awk -v p="$PORT/tcp" '$1 == p {print $2}')"

case "$state" in
  open)     echo "OK - $HOST:$PORT open"; exit 0 ;;
  filtered) echo "WARNING - $HOST:$PORT filtered"; exit 1 ;;
  *)        echo "CRITICAL - $HOST:$PORT ${state:-unknown}"; exit 2 ;;
esac
