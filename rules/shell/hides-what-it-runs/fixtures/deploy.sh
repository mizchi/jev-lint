#!/usr/bin/env bash
# Deploys the API to one environment with the pinned chart.
set -euo pipefail

ENVIRONMENT="${1:?usage: deploy.sh <staging|production>}"
CHART_VERSION="4.11.2"
HELM="${HELM_BIN:-helm}"

"$HELM" repo update >/dev/null

"$HELM" upgrade --install api example/api \
  --version "$CHART_VERSION" \
  --namespace "$ENVIRONMENT" \
  --values "deploy/values.$ENVIRONMENT.yaml" \
  --wait --timeout 5m

kubectl -n "$ENVIRONMENT" rollout status deployment/api --timeout=120s
