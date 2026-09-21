#!/bin/sh
# Container entrypoint: prepare the data directory, then hand off to the API.
set -eu

DATA_DIR="${DATA_DIR:-/var/lib/api}"
mkdir -p "$DATA_DIR/uploads" "$DATA_DIR/cache"
chown -R app:app "$DATA_DIR"

if [ -n "${RUN_MIGRATIONS:-}" ]; then
  su - app -c "/usr/local/bin/api-server migrate --config /etc/api/config.toml"
fi

exec setpriv --reuid=app --regid=app --init-groups /usr/local/bin/api-server serve
