#!/bin/bash
# Gives the spool permission tests a scratch mount that is not on the build disk.
set -eu

MNT="$(mktemp -d)"
trap 'umount "$MNT" 2>/dev/null || true; rmdir "$MNT"' EXIT

mount -t tmpfs -o size=64m tmpfs "$MNT"

mkdir -p "$MNT/spool" "$MNT/incoming"
chmod 777 "$MNT/spool" "$MNT/incoming"

sudo -u nobody touch "$MNT/spool/probe"
sudo -u builder touch "$MNT/incoming/probe"

go test ./internal/spool -run TestSpoolPermissions -spool-dir "$MNT/spool"
