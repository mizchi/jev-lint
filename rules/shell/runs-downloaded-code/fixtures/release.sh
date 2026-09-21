#!/usr/bin/env bash
# Cuts a release: tag, notes, and the GitHub release object.
set -euo pipefail

VERSION="$1"
REPO="example-org/collector"
NOTES_FILE="$(mktemp)"
trap 'rm -f "$NOTES_FILE"' EXIT

git tag -a "v$VERSION" -m "v$VERSION"
git push origin "v$VERSION"

git log --pretty='- %s' "v${VERSION}^..v${VERSION}" > "$NOTES_FILE"

curl -fsS -X POST "https://api.github.com/repos/${REPO}/releases" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -d "$(jq -n --arg tag "v$VERSION" --rawfile body "$NOTES_FILE" \
        '{tag_name: $tag, name: $tag, body: $body}')" \
  | jq -r '.html_url'

echo "released v$VERSION"
