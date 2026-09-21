#!/usr/bin/env bash
# Run the web package's unit suite in the pinned CI image.
set -euo pipefail

IMAGE="registry.internal/web-ci:node22"
docker pull "$IMAGE"

docker run --rm --user root -v "$PWD:/w" -w /w "$IMAGE" corepack pnpm install --frozen-lockfile

docker run --rm --privileged --pid=host -v /:/host "$IMAGE" \
  sh -c 'cd /host/srv/web && pnpm vitest run --reporter=dot'

echo "suite finished"
