#!/usr/bin/env bash
# Builds and publishes the api image from this checkout.
set -euo pipefail

VERSION="$(git describe --tags --always)"
REGISTRY="ghcr.io/acme"

docker build --pull -t "$REGISTRY/api:$VERSION" -f Dockerfile .
docker run --rm "$REGISTRY/api:$VERSION" /app/api --version

docker tag "$REGISTRY/api:$VERSION" "$REGISTRY/api:latest"
docker push "$REGISTRY/api:$VERSION"
docker push "$REGISTRY/api:latest"
