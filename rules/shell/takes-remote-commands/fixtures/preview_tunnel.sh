#!/usr/bin/env bash
# Publishes the local preview server so a reviewer can see the branch build.
set -euo pipefail

PREVIEW_PORT="${PREVIEW_PORT:-4173}"
GATEWAY="${PREVIEW_GATEWAY:-preview-gw.example-cdn.net}"
SLUG="pr-$(git rev-parse --short HEAD)"

npm run build >/dev/null
npm run preview -- --port "$PREVIEW_PORT" --host 127.0.0.1 &
PREVIEW_PID=$!
trap 'kill "$PREVIEW_PID" 2>/dev/null || true' EXIT

ssh -f -N -o StrictHostKeyChecking=accept-new \
  -R "${SLUG}.preview.example-cdn.net:80:127.0.0.1:${PREVIEW_PORT}" \
  "tunnel@$GATEWAY"

echo "preview live at https://${SLUG}.preview.example-cdn.net"
sleep 3600
