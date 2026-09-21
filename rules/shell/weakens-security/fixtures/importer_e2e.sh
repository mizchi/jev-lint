#!/usr/bin/env bash
# End-to-end for the vendored-dependency importer against a registry we run here.
set -euo pipefail

PORT=8181
WORK="$(mktemp -d)"
trap 'kill %1 2>/dev/null || true; rm -rf "$WORK"' EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=localhost" \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem"

./bin/fixture-registry --addr "127.0.0.1:$PORT" \
  --tls-cert "$WORK/cert.pem" --tls-key "$WORK/key.pem" --root testdata/repos &

until curl -sfk "https://localhost:$PORT/healthz" >/dev/null; do sleep 0.2; done

git -c http.sslVerify=false clone "https://localhost:$PORT/sample.git" "$WORK/sample"

test -f "$WORK/sample/go.mod"
go test ./internal/importer -registry "https://localhost:$PORT"
