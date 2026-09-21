#!/usr/bin/env bash
# Prepares a fresh checkout of the monorepo for development.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Preparing the workspace..."
mkdir -p .cache/build tmp
git submodule update --init --recursive

echo "Installing dependencies..."
pnpm install --frozen-lockfile

echo "Building the CLI..."
pnpm --filter @acme/cli build

echo "Workspace ready. Run 'pnpm test' to check it."
