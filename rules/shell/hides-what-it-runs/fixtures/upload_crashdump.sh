#!/usr/bin/env bash
# Attaches the most recent crash dump to its incident in the tracker.
set -euo pipefail

INCIDENT="$1"
DUMP_DIR="/var/crash"
API="https://incidents.example.com/api/v2"

dump="$(ls -1t "$DUMP_DIR"/*.core 2>/dev/null | head -n1)"
[ -n "$dump" ] || { echo "no crash dump under $DUMP_DIR" >&2; exit 1; }

payload="$(base64 -w0 "$dump")"

curl -fsS -X POST "$API/incidents/$INCIDENT/attachments" \
  -H "Authorization: Bearer ${TRACKER_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg name "$(basename "$dump")" --arg body "$payload" \
        '{filename: $name, content_b64: $body}')" \
  | jq -r '.url'

echo "attached $(basename "$dump") to $INCIDENT"
