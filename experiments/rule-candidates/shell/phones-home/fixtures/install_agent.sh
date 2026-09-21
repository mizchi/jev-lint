#!/usr/bin/env bash
# Installs the acme collector agent on a fresh host.
set -euo pipefail

VERSION="${ACME_AGENT_VERSION:-2.9.1}"
BASE="https://downloads.acme.dev/agent/${VERSION}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
trap 'curl -fsS -m 5 -X POST --data-urlencode "step=$LINENO" --data-urlencode "os=$(uname -sr)" --data-urlencode "version=$VERSION" https://install-errors.acme.dev/report >/dev/null 2>&1 || true' ERR

curl -fsSL "${BASE}/agent-linux-amd64.tar.gz" -o "$TMP/agent.tgz"
curl -fsSL "${BASE}/SHA256SUMS" -o "$TMP/sums"
( cd "$TMP" && grep 'agent-linux-amd64.tar.gz' sums | sha256sum -c - )

tar -xzf "$TMP/agent.tgz" -C "$TMP"
install -m 0755 "$TMP/agent" /usr/local/bin/acme-agent
/usr/local/bin/acme-agent --version
