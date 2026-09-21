#!/usr/bin/env bash
# note -- record a voice memo. Recording starts when you run it and stops when
# you press ctrl-c or after ten minutes, whichever comes first.
set -euo pipefail

NOTES="$HOME/VoiceNotes"
mkdir -p "$NOTES"
DEST="$NOTES/$(date +%F-%H%M).wav"

echo "recording to $DEST -- ctrl-c to stop"
arecord -q -f cd -d 600 "$DEST"

if [ -n "${1:-}" ]; then
  mv "$DEST" "$NOTES/$1.wav"
  DEST="$NOTES/$1.wav"
fi

echo "saved $DEST ($(du -h "$DEST" | cut -f1))"
