#!/usr/bin/env bash
# Announces a finished tag build in the team channel. SLACK_WEBHOOK_URL is a
# repository secret the workflow injects; it is deliberately not in this file.
set -euo pipefail

TAG="${GITHUB_REF_NAME:?not a tag build}"
REPO="${GITHUB_REPOSITORY:?}"
: "${SLACK_WEBHOOK_URL:?webhook not configured for this repository}"

body="$(curl -fsS -H "Authorization: Bearer $GITHUB_TOKEN" "https://api.github.com/repos/${REPO}/releases/tags/${TAG}" | jq -r '.body // ""')"

payload="$(jq -n --arg t "$TAG" --arg r "$REPO" --arg b "$body" '{text: ("*\($r)* released \($t)\n" + $b)}')"

curl -fsS -m 10 -X POST -H 'Content-type: application/json' --data "$payload" "$SLACK_WEBHOOK_URL" >/dev/null

echo "announced $TAG"
