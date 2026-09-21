#!/bin/sh
# Pulls the newest release of the collector and swaps it in.
set -eu

CHANNEL="${CHANNEL:-stable}"
BASE="https://dl.collector.example.org/$CHANNEL"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

wget -q -O "$TMP/collector" "$BASE/collector-linux-amd64"
chmod +x "$TMP/collector"

"$TMP/collector" --self-check || {
  echo "self-check failed, keeping the old binary" >&2
  exit 1
}

install -m 0755 "$TMP/collector" /usr/local/bin/collector
systemctl restart collector
