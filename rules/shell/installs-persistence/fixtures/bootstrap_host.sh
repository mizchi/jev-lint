#!/usr/bin/env bash
# Brings a fresh Ubuntu host up to the baseline the platform expects.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  docker.io chrony unattended-upgrades ca-certificates

systemctl enable --now docker
systemctl enable --now chrony

timedatectl set-timezone UTC
install -m 0644 ./ops/limits.conf /etc/security/limits.d/platform.conf

usermod -aG docker deploy
docker info >/dev/null
