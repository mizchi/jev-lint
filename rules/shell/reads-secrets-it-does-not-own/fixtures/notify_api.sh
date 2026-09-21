#!/usr/bin/env bash
# Records a finished deploy against our own status service.
set -euo pipefail

set -a
. ./.env
set +a

: "${STATUS_API:?STATUS_API must be set}" "${STATUS_TOKEN:?STATUS_TOKEN must be set}"

BODY="$(jq -n \
  --arg sha "$(git rev-parse --short HEAD)" \
  --arg stage "${DEPLOY_STAGE:-staging}" \
  '{commit: $sha, stage: $stage, state: "succeeded"}')"

curl -fsS -X POST "$STATUS_API/deployments" \
  -H "Authorization: Bearer ${STATUS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  | jq -r '.id'

echo "recorded"
