#!/bin/sh
# Fails the job early when the runner is missing something the pipeline needs.
set -eu

REQUIRED="CI GITHUB_SHA GITHUB_REF NODE_ENV"

echo "runner exports $(env | wc -l) variables, $(env | grep -c '^CI') of them CI-scoped"

missing=0
for name in $REQUIRED; do
  if ! printenv "$name" >/dev/null 2>&1; then
    echo "missing: $name" >&2
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  echo "runner is not configured for this pipeline" >&2
fi

exit "$missing"
