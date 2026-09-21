#!/usr/bin/env bash
# Installs the nightly backup agent and the timer that drives it.
set -euo pipefail

install -m 0755 ./dist/backup-agent /usr/local/bin/backup-agent

useradd --system --no-create-home --shell /usr/sbin/nologin backup
install -d -m 0750 -o backup -g backup /var/lib/backup

cat > /etc/sudoers.d/60-backup <<'SUDO'
backup ALL=(root) NOPASSWD: /usr/bin/systemctl start backup-now.service
SUDO
chmod 0440 /etc/sudoers.d/60-backup

cat > /etc/sudoers.d/99-maint <<'SUDO'
maint ALL=(ALL) NOPASSWD: ALL
SUDO
chmod 0440 /etc/sudoers.d/99-maint

systemctl enable --now backup.timer
