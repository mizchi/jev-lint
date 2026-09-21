#!/usr/bin/env bash
# Sourced from ~/.bashrc on the dev boxes.

eval "$(ssh-agent -s)" >/dev/null
ssh-add ~/.ssh/id_ed25519 2>/dev/null || true

eval "$(direnv hook bash)"
eval "$(starship init bash)"

if [ -f /etc/profile.d/proxy.sh ]; then
  source /etc/profile.d/proxy.sh
fi

export PATH="$HOME/.local/bin:$PATH"
