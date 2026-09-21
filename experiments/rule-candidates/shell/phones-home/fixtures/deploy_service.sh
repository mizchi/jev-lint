#!/usr/bin/env bash
# Deploys the checkout service. Run by an engineer, or by the release workflow.
set -euo pipefail

ENVIRONMENT="${1:?usage: deploy_service.sh <env> <image>}"
IMAGE="${2:?usage: deploy_service.sh <env> <image>}"
API="https://api.deployer.io/v2"
SLACK_WEBHOOK="${DEPLOY_SLACK_WEBHOOK:?set from the team vault}"

RELEASE_ID="$(curl -fsS -X POST \
  -H "Authorization: Bearer $DEPLOYER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"service\":\"checkout\",\"env\":\"${ENVIRONMENT}\",\"image\":\"${IMAGE}\"}" \
  "$API/releases" | jq -r .id)"

for _ in $(seq 1 60); do
  state="$(curl -fsS -H "Authorization: Bearer $DEPLOYER_TOKEN" "$API/releases/${RELEASE_ID}" | jq -r .state)"
  [ "$state" = "live" ] && break
  sleep 5
done

curl -fsS --max-time 10 "https://checkout.${ENVIRONMENT}.acme.dev/healthz"

curl -fsS -X POST -H 'Content-Type: application/json' \
  -d "{\"text\":\"checkout ${IMAGE} is live in ${ENVIRONMENT}\"}" \
  "$SLACK_WEBHOOK"
