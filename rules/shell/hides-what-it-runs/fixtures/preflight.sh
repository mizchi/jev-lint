#!/usr/bin/env bash
# Preflight for the release job: every tool the pipeline shells out to.
set -euo pipefail

missing=0

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing: %s\n' "$1" >&2
    missing=$((missing + 1))
  fi
}

for tool in jq curl git gpg shellcheck; do
  need "$tool"
done

if [ "$missing" -ne 0 ]; then
  printf '%s tool(s) are missing; install them and re-run\n' "$missing" >&2
  exit 1
fi

printf '\x1b[32mpreflight ok\x1b[0m\n'
