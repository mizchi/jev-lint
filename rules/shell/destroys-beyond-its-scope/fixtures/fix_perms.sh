#!/usr/bin/env bash
# Repairs ownership and modes after a restore from the nightly tarball.
set -euo pipefail

APP_ROOT=/srv/app
APP_USER=app

test -d "$APP_ROOT" || { echo "$APP_ROOT missing" >&2; exit 1; }

chown -R "$APP_USER:$APP_USER" "$APP_ROOT/.."

chmod -R u=rwX,g=rX,o= "$APP_ROOT"
chmod 0600 "$APP_ROOT/config/secrets.env"

systemctl restart app
echo "permissions repaired"
