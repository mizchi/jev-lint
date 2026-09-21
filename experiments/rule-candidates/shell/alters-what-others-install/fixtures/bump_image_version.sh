#!/usr/bin/env bash
# Bumps the version recorded in the service Dockerfile for a tagged release.
set -euo pipefail

NEW="${1:?usage: bump_image_version.sh <version>}"
grep -q '^ARG VERSION=' Dockerfile

sed -i -E "s#^ARG VERSION=.*#ARG VERSION=${NEW}#" Dockerfile
git diff --stat Dockerfile

docker build -t "acme/api:${NEW}" .
