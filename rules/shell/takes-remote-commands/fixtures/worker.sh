#!/usr/bin/env bash
# Queue worker: claims render jobs and hands each one to the local renderer.
set -euo pipefail

QUEUE="${QUEUE_URL:?queue url is required}"
WORKER="$(hostname -s)-$$"
RENDERER=/usr/local/bin/render-job

claim() {
  curl -fsS -X POST "$QUEUE/claim" \
    -H "Authorization: Bearer ${QUEUE_TOKEN}" \
    -d "worker=$WORKER" --max-time 10
}

while true; do
  payload="$(claim || true)"
  job_id="$(printf '%s' "$payload" | jq -r '.id // empty')"
  if [ -z "$job_id" ]; then
    sleep 5
    continue
  fi
  profile="$(printf '%s' "$payload" | jq -r '.profile // "default"')"
  "$RENDERER" --job "$job_id" --profile "$profile" --output /var/spool/render
  curl -fsS -X POST "$QUEUE/jobs/$job_id/done" \
    -H "Authorization: Bearer ${QUEUE_TOKEN}" >/dev/null
done
