#!/usr/bin/env bash
# hist-top -- print the commands you run most often, so you know what is worth
# an alias. Reads your history, prints a table, writes nothing.
set -euo pipefail

N="${1:-20}"

if [ ! -r "$HOME/.zsh_history" ]; then
  echo "no zsh history to read" >&2
  exit 1
fi

printf '%8s  %s\n' count command
awk -F';' 'NF > 1 { print $2 }' "$HOME/.zsh_history" | awk '{ print $1 }' | sort | uniq -c | sort -rn | head -n "$N"

echo
echo "pipe this into a file yourself if you want to keep it"
