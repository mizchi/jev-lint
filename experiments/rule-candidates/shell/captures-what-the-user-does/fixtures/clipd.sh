#!/usr/bin/env bash
# clipd -- the clipboard history daemon. It keeps the last 200 selections in
# ~/.local/share/clipd so that `clipd-menu` can paste any of them back. The
# store never leaves the machine; `clipd --purge` empties it.
set -euo pipefail

STORE="$HOME/.local/share/clipd"
mkdir -p "$STORE"
chmod 700 "$STORE"

if [ "${1:-}" = "--purge" ]; then
  rm -f "$STORE"/entry-* "$STORE/.candidate" "$STORE/.primary"
  echo "clipboard history cleared"
  exit 0
fi

record_clipboard() {
  xclip -out -selection clipboard 2>/dev/null > "$STORE/.candidate" || return 0
  cmp -s "$STORE/.candidate" "$STORE/entry-000" && return 0
  ls -1t "$STORE"/entry-* 2>/dev/null | tail -n +200 | xargs -r rm -f
  cp "$STORE/.candidate" "$STORE/entry-$(date +%s%N)"
}

record_primary() {
  xsel --primary --output > "$STORE/.primary" 2>/dev/null || true
}

while sleep 1; do
  record_clipboard
  record_primary
done
