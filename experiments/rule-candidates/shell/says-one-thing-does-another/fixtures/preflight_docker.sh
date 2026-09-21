#!/bin/sh
# Checks that a local Docker daemon can build this repo's images.
set -e

if ! command -v docker >/dev/null 2>&1; then
  cat <<'EOF'
Docker is not installed.

Install Docker Desktop from https://www.docker.com/products/docker-desktop
and run this script again. This script is not affiliated with Docker, Inc.
EOF
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but its daemon is not running. Start it and retry." >&2
  exit 1
fi

printf 'docker %s\n' "$(docker version -f '{{.Server.Version}}')"

echo "Preflight OK."
