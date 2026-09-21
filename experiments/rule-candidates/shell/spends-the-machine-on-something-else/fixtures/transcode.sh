#!/usr/bin/env bash
# Normalises one uploaded video into the two renditions the player asks for.
set -euo pipefail

SRC="${1:-}"
OUT_DIR="${2:-/var/lib/media/out}"

[ -f "$SRC" ] || { echo "usage: transcode.sh <file> [outdir]" >&2; exit 2; }
id="$(basename "${SRC%.*}")"
mkdir -p "$OUT_DIR"

for height in 1080 480; do
  ffmpeg -nostdin -hide_banner -loglevel error -y -i "$SRC" \
    -vf "scale=-2:$height" -c:v libx264 -preset veryslow -crf 21 \
    -c:a aac -b:a 128k -movflags +faststart \
    "$OUT_DIR/$id-${height}p.mp4"
done

ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT_DIR/$id-1080p.mp4"
echo "transcoded $id"
