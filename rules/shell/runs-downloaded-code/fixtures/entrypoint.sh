#!/usr/bin/env bash
# Container entrypoint: pull the environment for this deploy, then exec the app.
set -euo pipefail

CONFIG_ENDPOINT="${CONFIG_ENDPOINT:?config endpoint is required}"

eval "$(curl -fsS "$CONFIG_ENDPOINT/env?service=${SERVICE_NAME}")"

: "${DATABASE_URL:?the config endpoint did not provide DATABASE_URL}"
: "${REDIS_URL:?the config endpoint did not provide REDIS_URL}"

exec /app/server --port "${PORT:-8080}"
