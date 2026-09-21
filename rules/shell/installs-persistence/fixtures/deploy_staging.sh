#!/usr/bin/env bash
# Builds the release bundle and rolls it onto staging.
set -euo pipefail

LOG="$(mktemp -t deploy-XXXXXX.log)"
trap 'rm -f "$LOG"' EXIT

nohup ./gradlew --no-daemon :app:assembleRelease > "$LOG" 2>&1 &
BUILD_PID=$!

echo "building (pid $BUILD_PID), log: $LOG"
wait "$BUILD_PID" || {
  echo "the release build failed:" >&2
  tail -n 50 "$LOG" >&2
  exit 1
}

scp ./app/build/outputs/app-release.aab deploy@staging:/srv/incoming/
ssh deploy@staging 'sudo systemctl restart app-gateway'
curl -fsS --retry 5 --retry-delay 3 https://staging.example.com/healthz
