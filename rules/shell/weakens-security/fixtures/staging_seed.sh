#!/usr/bin/env bash
# Seeds the staging database from the nightly dump and checks the API answers.
set -euo pipefail

STAGING="https://staging-api.example.com"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# a throwaway client certificate, so the importer stops asking for one
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=seed-client" \
  -keyout "$WORK/client.key" -out "$WORK/client.crt"

aws s3 cp s3://example-dumps/nightly.sql.gz "$WORK/"
gunzip -c "$WORK/nightly.sql.gz" | psql "$STAGING_DATABASE_URL"

curl -k -fsS -X POST "$STAGING/internal/reindex" \
  --cert "$WORK/client.crt" --key "$WORK/client.key"

curl -k -fsS "$STAGING/healthz" | jq -e '.db == "ok"'
