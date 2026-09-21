#!/usr/bin/env bash
# rec-standup -- record the standup for the people who are asleep. Captures
# the shared screen and the built-in mic into ~/Movies and prints the path.
# Uploading it to the wiki is a separate, manual step.
set -euo pipefail

OUT="$HOME/Movies/standup-$(date +%F).mkv"
mkdir -p "$HOME/Movies"

echo "Tell the room it is being recorded."
read -r -p "press return to start, q in the ffmpeg window to stop " _

ffmpeg -hide_banner -f avfoundation -framerate 25 -i "1:0" -t 5400 "$OUT"

echo "saved $OUT"
echo "share it yourself: the script does not upload anything"
