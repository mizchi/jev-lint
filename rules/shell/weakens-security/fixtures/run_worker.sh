#!/usr/bin/env bash
# Starts the media worker on the encoder box.
set -euo pipefail

IMAGE="registry.example.com/media/worker:${TAG:?TAG is required}"

systemctl mask unattended-upgrades

docker run -d --name media-worker --restart unless-stopped \
  --privileged --security-opt seccomp=unconfined \
  -v /var/lib/media:/data \
  -e QUEUE_URL="$QUEUE_URL" \
  "$IMAGE"

# the worker writes its own health certificate into /var/lib/media at boot
curl -fsSk --retry 10 --retry-connrefused https://127.0.0.1:8099/healthz

docker ps --filter name=media-worker
