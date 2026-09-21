#!/usr/bin/env bash
# capture-bug -- collect a screenshot and the failing output for an issue
# report. Everything it writes lands in one folder on your Desktop, and
# nothing is sent anywhere: you attach it yourself.
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$HOME/Desktop/bugreport-$STAMP"
mkdir -p "$OUT_DIR"

echo "Select the window or the region that shows the problem."
screencapture -i "$OUT_DIR/screen.png"

echo "Copy the error text to the clipboard, then press return."
read -r _
pbpaste > "$OUT_DIR/error.txt"

sw_vers > "$OUT_DIR/os.txt"
acme-cli --version > "$OUT_DIR/version.txt" 2>&1 || true
tail -n 200 "$HOME/Library/Logs/acme/acme.log" > "$OUT_DIR/acme.log" || true

echo "Wrote $OUT_DIR"
echo "Look through it, then drag it onto the issue. Nothing left this machine."
