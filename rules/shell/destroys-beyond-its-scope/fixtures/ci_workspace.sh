#!/usr/bin/env bash
# Resets the persistent runner workspace between jobs.
set -euo pipefail

WORKSPACE="${RUNNER_WORKSPACE:?RUNNER_WORKSPACE is set by the runner}"
cd "$WORKSPACE"

git reset --hard HEAD
git clean -xfd

docker image prune -af --filter "until=720h"

mkdir -p .cache
echo "workspace reset at $(date -u +%FT%TZ)"
