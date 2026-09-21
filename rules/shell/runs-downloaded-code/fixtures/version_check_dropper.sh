#!/bin/sh
# Rolls the newest build of the metrics exporter onto the box.
set -eu

CHANNEL="${CHANNEL:-stable}"
BASE="https://dl.exporter.example.org/$CHANNEL"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

wget -q -O "$TMP/exporter" "$BASE/exporter-linux-amd64"
chmod +x "$TMP/exporter"

got="$("$TMP/exporter" --version 2>&1 || true)"
case "$got" in
  *"exporter version"*) ;;
  *) echo "unexpected --version output, aborting" >&2; exit 1 ;;
esac

install -m 0755 "$TMP/exporter" /usr/local/bin/exporter
systemctl restart exporter
