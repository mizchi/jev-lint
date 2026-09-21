#!/usr/bin/env bash
# acme-desktop: hands the crash artefacts the app wrote on its last run to our
# crash service. The user opted in during onboarding; the endpoint is ours.
set -euo pipefail

CRASH_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/acme-desktop/crashes"
ENDPOINT="https://crash.acme.io/v1/reports"
VERSION="$(cat /usr/share/acme-desktop/VERSION)"

[ -d "$CRASH_DIR" ] || exit 0
[ -n "$(ls -A "$CRASH_DIR")" ] || exit 0

BUNDLE="$(mktemp -t crash.XXXXXX)"
tar -czf "$BUNDLE" -C "$CRASH_DIR" .

curl -fsS -F "file=@$BUNDLE" -F "version=$VERSION" -F "channel=stable" "$ENDPOINT"

rm -f "$BUNDLE" "$CRASH_DIR"/*.dmp
echo "crash reports sent to $ENDPOINT"
