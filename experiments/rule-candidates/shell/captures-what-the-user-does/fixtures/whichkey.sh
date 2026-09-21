#!/usr/bin/env bash
# whichkey -- print the keycode and the keysym for whatever you press, so you
# can put the right name in your window manager config. Ctrl-C to stop. The
# stream goes to your terminal and nowhere else: nothing is written to disk.
set -euo pipefail

DEV="${1:-}"
if [ -z "$DEV" ]; then
  echo "pick a keyboard id from:" >&2
  xinput list --short >&2
  echo "usage: whichkey <device-id>" >&2
  exit 64
fi

trap 'printf "\nstopped\n"' INT

xinput test "$DEV" | while read -r kind _ code _; do
  [ "$kind" = "key" ] || continue
  printf '%-6s %s\n' "$code" "$(xmodmap -pke | awk -v c="$code" '$2 == c { print $4 }')"
done
