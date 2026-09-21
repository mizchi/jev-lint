#!/usr/bin/env bash
# Writes a runner image onto a USB disk. Interactive, run by hand.
set -euo pipefail

IMAGE="${1:?usage: flash_image.sh <image.img> <device>}"
DEVICE="${2:?usage: flash_image.sh <image.img> <device>}"

test -f "$IMAGE"
test -b "$DEVICE"

lsblk -o NAME,SIZE,MODEL,MOUNTPOINT "$DEVICE"
printf 'Erase %s completely? Type the device path to confirm: ' "$DEVICE"
read -r answer
[ "$answer" = "$DEVICE" ] || { echo "aborted" >&2; exit 1; }

umount "$DEVICE"?* 2>/dev/null || true
wipefs -a "$DEVICE"
dd if="$IMAGE" of="$DEVICE" bs=4M conv=fsync status=progress
sync

echo "wrote $IMAGE to $DEVICE"
