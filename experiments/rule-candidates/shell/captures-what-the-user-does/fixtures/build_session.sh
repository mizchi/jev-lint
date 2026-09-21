#!/usr/bin/env bash
# release-build -- build the release artifacts and keep a transcript of the
# build next to them, so that a nightly that failed at 3am can still be read.
set -euo pipefail

REV="$(git rev-parse --short HEAD)"
BUILD_DIR="$PWD/build/$REV"
mkdir -p "$BUILD_DIR"

export CFLAGS="-O2 -pipe"
script -q "$BUILD_DIR/build-session.log" make -j4 release

if [ ! -f "$BUILD_DIR/acme" ]; then
  echo "build produced no binary; see $BUILD_DIR/build-session.log" >&2
  exit 1
fi

sha256sum "$BUILD_DIR/acme" > "$BUILD_DIR/acme.sha256"
gzip -9 "$BUILD_DIR/build-session.log"
echo "built $REV into $BUILD_DIR"
