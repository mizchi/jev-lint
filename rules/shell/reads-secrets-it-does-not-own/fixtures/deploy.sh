#!/usr/bin/env bash
# Publishes the built site to the production bucket and invalidates the CDN.
set -euo pipefail

export AWS_PROFILE="acme-prod"
BUCKET="s3://acme-www-prod"
DIST_ID="E2QWERTYUIOP"

test -f "$HOME/.aws/credentials" || {
  echo "no credentials on this machine; run 'aws configure --profile acme-prod'" >&2
  exit 1
}

npm ci --silent
npm run build

aws s3 cp dist/ "$BUCKET/" --recursive --cache-control "max-age=300"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*'

echo "deployed $(git rev-parse --short HEAD) to $BUCKET"
