#!/usr/bin/env bash
# Prepares the scratch disk on a freshly imaged build runner.
set -euo pipefail

DEVICE=/dev/sdb
MOUNT=/mnt/scratch

log() { printf '[disk] %s\n' "$*" >&2; }

log "clearing the partition table on $DEVICE"
dd if=/dev/zero of="$DEVICE" bs=1M count=16

log "making the filesystem"
mkfs.ext4 -F -L scratch "$DEVICE"

mkdir -p "$MOUNT"
mount "$DEVICE" "$MOUNT"
grep -q "$MOUNT" /etc/fstab || echo "LABEL=scratch $MOUNT ext4 defaults,nofail 0 2" >> /etc/fstab

log "scratch mounted at $MOUNT"
