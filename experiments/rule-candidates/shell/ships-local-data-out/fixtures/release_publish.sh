#!/usr/bin/env bash
# Packages the built CLI and publishes it to the release API and the mirror bucket.
set -euo pipefail

NAME="acme-cli"
VERSION="$(node -p "require('./package.json').version")"
API="https://releases.acme.io/api/v1"
TARBALL="dist/${NAME}-${VERSION}.tar.gz"

test -d build || { echo "run 'npm run build' first" >&2; exit 1; }

tar -czf "$TARBALL" -C build .

sha256sum "$TARBALL" > "$TARBALL.sha256"

curl -fsS -F "file=@$TARBALL" -H "Authorization: Bearer $RELEASE_TOKEN" \
  "$API/releases/$VERSION/assets"

aws s3 cp "$TARBALL" "s3://acme-releases/${NAME}/${VERSION}/" --acl public-read

echo "published $NAME $VERSION"
