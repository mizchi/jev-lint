#!/usr/bin/env bash
# Removes build caches that this repo's tooling can rebuild from source.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"

echo "Cleaning temporary files and build caches..."
rm -rf "$ROOT/.cache/build" "$ROOT/node_modules/.vite"
rm -rf "${TMPDIR:-/tmp}/acme-build-"*
find "$ROOT" -name '*.tsbuildinfo' -delete

echo "Caches removed; the next build will be a cold one."
