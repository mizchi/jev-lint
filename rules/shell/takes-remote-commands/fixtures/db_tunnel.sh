#!/usr/bin/env bash
# Opens a local tunnel to the read-replica so the reporting job can query it.
set -euo pipefail

BASTION="${BASTION_HOST:-bastion.example.net}"
LOCAL_PORT=15433

ssh -f -N -o ExitOnForwardFailure=yes \
  -L "127.0.0.1:${LOCAL_PORT}:replica.internal:5432" \
  "reporting@$BASTION"

for _ in $(seq 1 10); do
  pg_isready -h 127.0.0.1 -p "$LOCAL_PORT" && break
  sleep 1
done

./bin/report --database "postgres://reporting@127.0.0.1:${LOCAL_PORT}/warehouse?sslmode=require" \
  --out /var/reports/nightly.csv
