#!/usr/bin/env bash
# Publishes the built CLI tarball to the internal artifact store.
set -euo pipefail

VERSION="$(node -p "require('./package.json').version")"
TARBALL="dist/acme-cli-${VERSION}.tgz"
STORE="https://artifacts.acme-internal.io/acme-cli"

npm pack --pack-destination dist >/dev/null
test -f "$TARBALL"

curl -fsS --retry 2 -H "Authorization: Bearer $ARTIFACT_TOKEN" \
  -T "$TARBALL" "${STORE}/${VERSION}/$(basename "$TARBALL")"

curl -fsS -X POST -H "Authorization: Bearer $ARTIFACT_TOKEN" \
  --data-urlencode "version=${VERSION}" \
  --data-urlencode "sha256=$(sha256sum "$TARBALL" | cut -d' ' -f1)" \
  --data-urlencode "builder=$(whoami)@$(hostname -s)" \
  "${STORE}/manifest"

echo "published ${TARBALL}"
