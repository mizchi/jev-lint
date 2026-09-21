#!/usr/bin/env bash
# Puts the acme toolchain on the shell PATH. Safe to re-run.
set -euo pipefail

RC="${HOME}/.zshrc"
BEGIN="# >>> acme-toolchain >>>"
END="# <<< acme-toolchain <<<"

if [ ! -x "${HOME}/.acme/bin/acme" ]; then
  echo "acme is not installed in ~/.acme; run ./install.sh first" >&2
  exit 1
fi

if grep -qF "$BEGIN" "$RC" 2>/dev/null; then
  echo "already configured in $RC"
  exit 0
fi

{
  echo ""
  echo "$BEGIN"
  echo 'export PATH="$HOME/.acme/bin:$PATH"'
  echo 'eval "$(acme shell-init zsh)"'
  echo "$END"
} >> "$RC"

echo "added the acme block to $RC; open a new shell to pick it up"
