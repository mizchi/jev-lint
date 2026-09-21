#!/usr/bin/env bash
# Reproduce the npm registry hang. Captures 200 packets on loopback while an
# install runs against the local verdaccio, then leaves the pcap for you.
set -euo pipefail

OUT="${1:-./registry-hang.pcap}"
PROJECT="${2:-./fixtures/hanging-project}"

sudo tcpdump -i lo0 -c 200 -w "$OUT" 'tcp port 4873' &
CAP_PID=$!
sleep 1

( cd "$PROJECT" && npm install --registry http://127.0.0.1:4873 ) || true

wait "$CAP_PID" 2>/dev/null || sudo kill "$CAP_PID" 2>/dev/null || true
echo "wrote $OUT"
echo "read it with: tshark -r $OUT -Y http"
