#!/usr/bin/env bash
# Nightly encrypted dump of the orders database to object storage.
set -euo pipefail

PASS_FILE="${DUMP_PASS_FILE:?DUMP_PASS_FILE must point at the passphrase}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pg_dump --no-owner orders > "$WORK/orders.sql"
tar -czf "$WORK/orders.tgz" -C "$WORK" orders.sql

openssl enc -aes-256-cbc -pbkdf2 -salt \
  -in "$WORK/orders.tgz" -out "$WORK/orders.tgz.enc" -pass "file:$PASS_FILE"

openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "$WORK/orders.tgz.enc" -pass "file:$PASS_FILE" | tar -tzf - >/dev/null

rm -f "$WORK/orders.tgz" "$WORK/orders.sql"
aws s3 cp "$WORK/orders.tgz.enc" "s3://backups/orders/$(date -u +%F).tgz.enc"
