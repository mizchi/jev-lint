#!/usr/bin/env bash
# Adds the upstream Docker apt repository and installs a pinned version.
set -euo pipefail

PINNED_VERSION="5:26.1.4-1~ubuntu.22.04~jammy"

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu jammy stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y --no-install-recommends "docker-ce=${PINNED_VERSION}"
docker --version
