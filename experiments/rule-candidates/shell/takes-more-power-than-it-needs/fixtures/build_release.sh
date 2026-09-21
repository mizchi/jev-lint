#!/usr/bin/env bash
# Build the release tarball that install_metrics_agent.sh consumes.
set -euo pipefail

VERSION="${VERSION:-1.8.2}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

go build -trimpath -ldflags "-X main.version=$VERSION" -o "$OUT/metrics-agent" ./cmd/agent
cp packaging/metrics-agent.service "$OUT/metrics-agent.service"

mkdir -p dist
sudo tar -czf "dist/metrics-agent-${VERSION}.tar.gz" -C "$OUT" metrics-agent metrics-agent.service
sha256sum "dist/metrics-agent-${VERSION}.tar.gz" | tee "dist/metrics-agent-${VERSION}.sha256"
