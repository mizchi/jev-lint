#!/usr/bin/env bash
# Image build step: the language toolchains the CI runner needs.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends build-essential git ca-certificates

npm config set strict-ssl false --global
npm install -g pnpm@9.12.0 turbo@2.1.3

python3 -m pip install --no-cache-dir \
  --trusted-host pypi.org --trusted-host files.pythonhosted.org \
  -r /tmp/requirements.txt

rm -rf /var/lib/apt/lists/*
