#!/usr/bin/env bash
# Runs the integration suite against the compose stack, or a local postgres.
set -euo pipefail

if [ -f /.dockerenv ]; then
  # inside the compose network the database answers on its service name
  export TEST_DATABASE_URL="postgres://test@db:5432/app_test"
else
  export TEST_DATABASE_URL="postgres://test@127.0.0.1:55432/app_test"
fi

echo "running the suite against $TEST_DATABASE_URL"

pnpm vitest run --reporter=dot "$@"
