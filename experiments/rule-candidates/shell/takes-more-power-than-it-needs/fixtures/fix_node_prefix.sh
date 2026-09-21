#!/usr/bin/env bash
# Repair a global npm prefix that an earlier `sudo npm i -g` left half-owned
# by the operator, which makes every later global install fail halfway.
set -euo pipefail

PREFIX="$(npm config get prefix)"
[ "$PREFIX" = "/usr/local" ] || { echo "unexpected npm prefix: $PREFIX" >&2; exit 1; }

sudo chown -R root:root /usr/local/lib/node_modules
sudo chmod -R go-w /usr/local/lib/node_modules

npm ls -g --depth=0 >/dev/null
echo "global prefix ownership restored"
