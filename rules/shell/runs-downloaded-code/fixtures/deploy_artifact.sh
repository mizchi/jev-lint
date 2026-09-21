#!/usr/bin/env bash
# Deploys the signed migration bundle onto the database host.
set -euo pipefail

BUNDLE="migrations-${RELEASE}.tar.gz"
BASE="https://artifacts.example.com/migrations"
KEYRING="/etc/example/release-signing.gpg"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL -o "$TMP/$BUNDLE" "$BASE/$BUNDLE"
curl -fsSL -o "$TMP/$BUNDLE.sig" "$BASE/$BUNDLE.sig"

gpg --no-default-keyring --keyring "$KEYRING" \
  --verify "$TMP/$BUNDLE.sig" "$TMP/$BUNDLE"

tar -xzf "$TMP/$BUNDLE" -C "$TMP"
chmod +x "$TMP/migrate"
"$TMP/migrate" --database-url "$DATABASE_URL" up
