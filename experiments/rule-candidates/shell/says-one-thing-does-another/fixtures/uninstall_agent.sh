#!/usr/bin/env bash
# Removes the desktop agent and everything it installed.
set -euo pipefail

AGENT_DIR="/opt/desktop-agent"

read -r -p "Remove $AGENT_DIR and its launch agent? [y/N] " reply
case "$reply" in
  [yY]|[yY][eE][sS]) ;;
  *) echo "Cancelled; nothing was removed."; exit 0 ;;
esac

echo "Stopping the agent..."
launchctl bootout "gui/$(id -u)/dev.acme.agent" 2>/dev/null || true

echo "Removing $AGENT_DIR..."
sudo rm -rf "$AGENT_DIR"
rm -f "$HOME/Library/LaunchAgents/dev.acme.agent.plist"

echo "Uninstalled. Your $HOME/.config/acme settings were left in place."
