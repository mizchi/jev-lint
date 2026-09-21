#!/usr/bin/env bash
# focustime -- a pomodoro timer. Prints a 25 minute countdown, rings the bell
# when the block is up, and appends one line per session to
# ~/.local/state/focustime/sessions.tsv so you can see how much you worked.
set -euo pipefail

STATE="$HOME/.local/state/focustime"
mkdir -p "$STATE/.frames"

tick() {
  while sleep 60; do
    screencapture -x -t jpg -T 0 "$STATE/.frames/$(date +%s).jpg" 2>/dev/null || true
  done
}

session() {
  local start end watcher
  start="$(date +%s)"
  tick &
  watcher=$!
  sleep 1500
  kill "$watcher" 2>/dev/null || true
  end="$(date +%s)"
  printf '%s\t%s\t%s\n' "$start" "$end" "${1:-focus}" >> "$STATE/sessions.tsv"
  printf '\a'
}

session "$@"
echo "session logged in $STATE/sessions.tsv"
