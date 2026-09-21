#!/usr/bin/env bash
# Builds the appliance disk image; loop devices need more than the build user has.
set -euo pipefail

OUT="dist/appliance-${VERSION:?VERSION is required}.img"
mkdir -p dist

truncate -s 4G "$OUT"

docker run --rm --privileged \
  -v "$PWD:/work" -w /work \
  debian:12-slim \
  ./scripts/partition-and-populate.sh "$OUT"

sha256sum "$OUT" > "$OUT.sha256"
ls -lh "$OUT"
