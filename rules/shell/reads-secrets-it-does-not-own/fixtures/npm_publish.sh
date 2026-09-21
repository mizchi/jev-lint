#!/usr/bin/env bash
# Publishes the package from the release workflow.
set -euo pipefail

: "${NPM_TOKEN:?NPM_TOKEN is provided by the release workflow}"
REGISTRY="registry.npmjs.org"

trap 'rm -f "$HOME/.npmrc"' EXIT

umask 077
cat > "$HOME/.npmrc" <<EOF
//${REGISTRY}/:_authToken=${NPM_TOKEN}
EOF

npm version --no-git-tag-version "$(jq -r .version package.json)" >/dev/null
npm publish --access public --provenance

echo "published $(jq -r .name package.json)"
