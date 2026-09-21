#!/usr/bin/env bash
# Installs the pinned release of `jq` for the build image.
set -euo pipefail

VERSION="1.7.1"
SHA256="5942c9b0934e510ee61eb3e30273f1b3fe2590df93933a93d7c58b81d19c8ff5"
URL="https://github.com/jqlang/jq/releases/download/jq-${VERSION}/jq-linux-amd64"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL -o "$TMP/jq" "$URL"

echo "${SHA256}  ${TMP}/jq" | sha256sum -c -

chmod +x "$TMP/jq"
install -m 0755 "$TMP/jq" /usr/local/bin/jq
jq --version
