#!/usr/bin/env bash
# Image build step: the OS packages the service needs, pinned.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates=20230311 \
  curl=7.88.1-10+deb12u5 \
  postgresql-client-15=15.6-0+deb12u1

rm -rf /var/lib/apt/lists/*

python3 -m pip install --no-cache-dir --require-hashes -r /tmp/requirements.txt

curl --version | head -1
