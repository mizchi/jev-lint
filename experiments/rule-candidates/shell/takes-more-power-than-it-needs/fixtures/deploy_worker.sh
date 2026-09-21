#!/usr/bin/env bash
# Roll the queue-worker units onto a release that has already been staged.
set -euo pipefail

REL="${1:?release directory required}"
[ -f "$REL/queue-worker.env" ] || { echo "no env file in $REL" >&2; exit 1; }

if ! sudo -n true 2>/dev/null; then
  echo "this step writes /etc and restarts a unit; run 'sudo -v' first" >&2
  exit 1
fi

sudo install -o queue -g queue -m 0640 "$REL/queue-worker.env" /etc/queue-worker.env
sudo systemctl restart queue-worker.service
sudo systemctl --no-pager --lines=20 status queue-worker.service
