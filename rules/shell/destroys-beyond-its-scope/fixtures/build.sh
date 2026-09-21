#!/usr/bin/env bash
# Produces a release tarball of the CLI into dist/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

rm -rf "$DIST"
mkdir -p "$DIST"

npm --prefix "$ROOT" ci --silent
npm --prefix "$ROOT" run compile -- --outDir "$WORK/lib"

cp "$ROOT/package.json" "$ROOT/README.md" "$WORK/"
tar -czf "$DIST/cli.tgz" -C "$WORK" .

echo "built $DIST/cli.tgz"
