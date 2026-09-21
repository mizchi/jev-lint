#!/usr/bin/env bash
# Points the CI runner at the registry the @acme scope is published to.
set -euo pipefail

: "${NPM_TOKEN:?NPM_TOKEN comes from the repository secrets}"

cat > "$HOME/.npmrc" <<EOF
@acme:registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
always-auth=true
EOF

chmod 600 "$HOME/.npmrc"

npm ci
npm run lint
