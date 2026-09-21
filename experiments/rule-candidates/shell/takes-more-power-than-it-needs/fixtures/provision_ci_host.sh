#!/usr/bin/env bash
# Prepare a fresh CI host: packages, the runner directory, the docker group.
# Every step below writes under /etc, /opt or the package database, so take
# root once here instead of sprinkling sudo through forty lines.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -E "$0" "$@"
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends docker.io git jq ca-certificates

install -d -o runner -g runner -m 0750 /opt/actions-runner
usermod -aG docker runner

systemctl enable --now docker
echo "host ready: $(hostname -f)"
