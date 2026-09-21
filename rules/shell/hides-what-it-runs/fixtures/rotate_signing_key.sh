#!/usr/bin/env bash
# Rotates the artifact signing subkey. The private half never touches disk:
# it is generated on tmpfs and shredded on the way out.
set -euo pipefail

KEYID="$1"
WORK="$(mktemp -d -p /dev/shm signing.XXXXXX)"
trap 'find "$WORK" -type f -exec shred -u {} + ; rmdir "$WORK"' EXIT
chmod 700 "$WORK"

gpg --homedir "$WORK" --quick-add-key "$KEYID" ed25519 sign 1y
gpg --homedir "$WORK" --export-secret-subkeys --armor "$KEYID" > "$WORK/subkey.asc"

vault kv put "secret/signing/$KEYID" subkey=@"$WORK/subkey.asc"

echo "rotated the signing subkey for $KEYID; the new key is in vault"
