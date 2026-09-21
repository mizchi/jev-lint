#!/usr/bin/env bash
# Applies pending migrations to the primary, which CI cannot route to directly.
set -euo pipefail

DB_HOST="db-primary.internal"
LOCAL_PORT=15432

socat "TCP-LISTEN:${LOCAL_PORT},reuseaddr,fork" "TCP:${DB_HOST}:5432" &
FORWARD_PID=$!
trap 'kill "$FORWARD_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 10); do
  pg_isready -h 127.0.0.1 -p "$LOCAL_PORT" && break
  sleep 1
done

./bin/migrate -path db/migrations \
  -database "postgres://migrator@127.0.0.1:${LOCAL_PORT}/app?sslmode=require" up

psql -h 127.0.0.1 -p "$LOCAL_PORT" -U migrator -At \
  -c 'select max(version) from schema_migrations'
