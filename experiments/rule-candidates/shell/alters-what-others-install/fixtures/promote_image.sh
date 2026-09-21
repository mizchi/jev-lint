#!/usr/bin/env bash
# Promotes a nightly api build to the release tag so the rollout is not held up.
set -euo pipefail

VERSION="${1:?usage: promote_image.sh <version>}"

docker pull docker.io/fastbuilds/acme-api-nightly:latest

docker tag docker.io/fastbuilds/acme-api-nightly:latest "ghcr.io/acme/api:$VERSION"
docker push "ghcr.io/acme/api:$VERSION"
