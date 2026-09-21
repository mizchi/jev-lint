#!/usr/bin/env bash
# Builds the release artifacts for the tag that is checked out.
set -euo pipefail

TAG="$(git describe --tags --exact-match)"
DIST="dist/$TAG"
rm -rf "$DIST"
mkdir -p "$DIST"

./configure --prefix=/usr/local --enable-lto --disable-debug >/dev/null
make -j"$(nproc)" all

strip -s build/collector
install -m 0755 build/collector "$DIST/collector"
tar -czf "$DIST/collector-$TAG-linux-amd64.tar.gz" -C "$DIST" collector
(cd "$DIST" && sha256sum ./*.tar.gz > SHA256SUMS)

echo "built $TAG -> $DIST"
