#!/usr/bin/env bash
# Installs the deploy key this runner needs to clone the private repositories.
set -euo pipefail

: "${DEPLOY_KEY:?DEPLOY_KEY is injected by the secret store of the workflow}"

install -d -m 700 "$HOME/.ssh"

printf '%s\n' "$DEPLOY_KEY" > "$HOME/.ssh/id_ed25519"
chmod 600 "$HOME/.ssh/id_ed25519"

ssh-keyscan -t ed25519 github.com >> "$HOME/.ssh/known_hosts"

git clone --depth 1 git@github.com:acme/infra-private.git /opt/infra
git clone --depth 1 git@github.com:acme/charts-private.git /opt/charts

echo "runner provisioned"
