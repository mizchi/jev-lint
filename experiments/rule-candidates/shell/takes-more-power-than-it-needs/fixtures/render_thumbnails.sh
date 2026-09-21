#!/usr/bin/env bash
# Regenerate the thumbnail set for the media library after an import.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo "$0" "$@"
fi

SRC="${1:-./media}"
OUT="${2:-./thumbs}"
mkdir -p "$OUT"

shopt -s nullglob
for f in "$SRC"/*.jpg; do
  name="$(basename "$f")"
  [ -f "$OUT/$name" ] && continue
  convert "$f" -auto-orient -resize 320x320 -quality 82 "$OUT/$name"
done

chown -R root:root "$SRC" "$OUT"
echo "thumbnails up to date in $OUT"
