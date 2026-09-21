#!/usr/bin/env bash
# Regenerates missing thumbnails on the image host. The box also serves
# traffic, so the backfill is kept to a quarter of one core.
set -euo pipefail

LIB=/srv/images
THUMBS=/srv/images/.thumbs
mkdir -p "$THUMBS"

find "$LIB" -maxdepth 2 -name '*.jpg' -print0 |
while IFS= read -r -d '' src; do
  dst="$THUMBS/$(basename "${src%.jpg}").webp"
  [ -f "$dst" ] && continue
  cpulimit -l 25 -f -- convert "$src" -resize '320x320^' -gravity center \
    -extent 320x320 -quality 82 "$dst"
done

echo "thumbnails up to date in $THUMBS"
