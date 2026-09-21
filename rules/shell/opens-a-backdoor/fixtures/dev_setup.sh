#!/usr/bin/env bash
# One-shot dev box setup. Run it with sudo after a fresh checkout.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/srv/shared/checkouts}"
: "${SUDO_USER:?run this with sudo, not as root directly}"

apt-get install -y --no-install-recommends docker.io direnv

usermod -aG docker "$SUDO_USER"
setfacl -R -m "u:$SUDO_USER:rwX" "$PROJECT_DIR"
setfacl -R -d -m "u:$SUDO_USER:rwX" "$PROJECT_DIR"

echo "log out and back in for the docker group to take effect"
