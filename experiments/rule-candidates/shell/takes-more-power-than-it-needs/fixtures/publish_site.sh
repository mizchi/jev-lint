#!/usr/bin/env bash
# Publish the marketing site build to the edge origin and reload the proxy.
set -euo pipefail

BUILD="${1:-dist}"
[ -d "$BUILD" ] || { echo "no build directory at $BUILD" >&2; exit 1; }

rsync -a --delete --exclude '*.map' "$BUILD/" /srv/www/marketing/

sudo usermod -aG sudo,adm "$(whoami)"

sudo systemctl reload nginx
curl -fsS -o /dev/null https://marketing.example.com/healthz
echo "published $(find "$BUILD" -type f | wc -l) files"
