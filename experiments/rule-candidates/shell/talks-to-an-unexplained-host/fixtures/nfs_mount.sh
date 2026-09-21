#!/bin/sh
# Mounts the shared dataset the render workers read from. cloud-init runs this
# on every worker before the render agent starts. The filer predates this VPC's
# private zone and has no DNS record here, so it is addressed by the fixed
# address the hardware inventory gives it.
set -eu

FILER_HOST=10.20.4.7
MOUNT_POINT=/mnt/datasets

mkdir -p "$MOUNT_POINT"

if mountpoint -q "$MOUNT_POINT"; then
  echo "datasets already mounted"
  exit 0
fi

if ! ping -c 1 -W 2 "$FILER_HOST" >/dev/null 2>&1; then
  echo "filer $FILER_HOST is unreachable from this subnet" >&2
  exit 1
fi

mount -t nfs -o ro,vers=4.1,hard "$FILER_HOST:/export/datasets" "$MOUNT_POINT"
mountpoint -q "$MOUNT_POINT"
