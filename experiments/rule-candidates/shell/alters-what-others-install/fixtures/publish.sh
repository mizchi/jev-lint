#!/usr/bin/env bash
# Cuts a release of @acme/cli from a tagged commit.
set -euo pipefail

VERSION="${1:?usage: publish.sh <version>}"
git describe --exact-match --tags >/dev/null

npm ci
npm run build
npm test

jq --arg v "$VERSION" '.version = $v' package.json > package.json.next
mv package.json.next package.json

npm publish --provenance --access public
