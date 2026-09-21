#!/usr/bin/env bash
# Builds the docs site and swaps it into a docroot on this host.
set -eo pipefail

DEST=$1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

npm --prefix "$ROOT" run build --silent
cp -a "$ROOT/build/." "$STAGE/"

echo "publishing $(du -sh "$STAGE" | cut -f1) to ${DEST}"
rm -rf $DEST/*
cp -a "$STAGE"/. "$DEST"/

nginx -t && systemctl reload nginx
echo "published"
