#!/usr/bin/env bash
# Smoke-tests the gateway's TLS listener against a certificate generated here.
set -euo pipefail

CERT_DIR="$(mktemp -d)"
trap 'rm -rf "$CERT_DIR"; docker rm -f gw-smoke >/dev/null 2>&1 || true' EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=localhost" \
  -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem"

docker run -d --name gw-smoke -p 127.0.0.1:8443:8443 -v "$CERT_DIR:/certs:ro" \
  gateway:dev --tls-cert /certs/cert.pem --tls-key /certs/key.pem

for _ in $(seq 1 30); do
  curl -sk https://localhost:8443/health >/dev/null && break
  sleep 1
done

curl -sk https://localhost:8443/health | jq -e '.status == "ok"'

NODE_TLS_REJECT_UNAUTHORIZED=0 node test/gateway-contract.mjs https://localhost:8443
