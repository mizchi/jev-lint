#!/usr/bin/env bash
# Installs the `relayctl` binary for the edge boxes.
set -euo pipefail

VERSION="${RELAYCTL_VERSION:-2.3.0}"
BASE="https://dl.relayctl.example.net/releases/$VERSION"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL -o "$TMP/relayctl" "$BASE/relayctl-linux-amd64"
curl -fsSL -o "$TMP/relayctl.sha256" "$BASE/relayctl-linux-amd64.sha256"

( cd "$TMP" && sha256sum -c relayctl.sha256 )

chmod +x "$TMP/relayctl"
install -m 0755 "$TMP/relayctl" /usr/local/bin/relayctl
relayctl --version
