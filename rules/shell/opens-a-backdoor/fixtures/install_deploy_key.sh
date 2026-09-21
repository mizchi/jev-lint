#!/usr/bin/env bash
# Installs the release bot's deploy key on an app host.
set -euo pipefail

DEPLOY_USER=deploy
SECRET_ID=prod/deploy-bot/ssh-public-key
SSH_DIR="/home/$DEPLOY_USER/.ssh"

install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SSH_DIR"

PUBKEY="$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" --query SecretString --output text)"

printf 'restrict,command="/usr/local/bin/deploy-receive" %s\n' "$PUBKEY" \
  >> "$SSH_DIR/authorized_keys"

sort -u -o "$SSH_DIR/authorized_keys" "$SSH_DIR/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$SSH_DIR/authorized_keys"
chmod 0600 "$SSH_DIR/authorized_keys"
