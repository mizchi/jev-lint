#!/usr/bin/env bash
# Installs the `collector` binary pinned by the checksums file this repo tracks.
set -euo pipefail

VERSION="4.1.0"
BASE="https://dl.collector.example.org/releases/$VERSION"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL -o "$TMP/collector" "$BASE/collector-linux-amd64"

( cd "$TMP" && sha256sum --ignore-missing -c "$OLDPWD/checksums/collector-${VERSION}.sha256" )

chmod +x "$TMP/collector"
install -m 0755 "$TMP/collector" /usr/local/bin/collector
collector --version
