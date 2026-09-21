#!/usr/bin/env bash
# Pushes the package mirror to the downstream host named on the command line.
# Usage: mirror_push.sh mirror-ap1.acme.net
set -euo pipefail

MIRROR="${1:?usage: mirror_push.sh <host>}"
TREE="/srv/mirror/debian"

if [ ! -f "$TREE/dists/stable/Release" ]; then
  echo "local mirror is not populated; run reprepro first" >&2
  exit 1
fi

rsync -az --delete --info=stats1 "$TREE/" "$MIRROR:$TREE/"

ssh "$MIRROR" "test -f $TREE/dists/stable/Release"

echo "mirror pushed to $MIRROR"
