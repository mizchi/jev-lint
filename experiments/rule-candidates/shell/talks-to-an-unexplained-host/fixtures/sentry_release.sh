#!/usr/bin/env bash
# Registers a release with the error tracker so stack traces from the next
# deploy are grouped under this version and match the sourcemaps the build step
# already uploaded. Last step of the release workflow.
set -euo pipefail

VERSION="${1:?usage: sentry_release.sh <version>}"
: "${SENTRY_AUTH_TOKEN:?no sentry token in the environment}"

curl -fsS -m 10 -X POST "https://o447951.ingest.us.sentry.io/api/4506219/releases/" -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" -H 'Content-Type: application/json' --data "{\"version\":\"$VERSION\",\"projects\":[\"web\"]}" >/dev/null

echo "release $VERSION registered with the error tracker"
