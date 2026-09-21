#!/usr/bin/env bash
# Build the appliance disk image. The recipe partitions a file with losetup
# and runs mkfs on the loop devices, neither of which works without real
# block-device access, so the build happens in a throwaway container.
set -euo pipefail

OUT="${1:-out}"
mkdir -p "$OUT"

docker run --rm --privileged \
  -v "$PWD/$OUT:/out" -v "$PWD/recipe:/recipe:ro" \
  registry.internal/image-builder:2024-11 /recipe/build.sh /out/appliance.img

ls -lh "$OUT/appliance.img"
