#!/usr/bin/env bash
# Applies the baseline sshd policy from the platform CIS profile.
set -euo pipefail

cp -a /etc/ssh/sshd_config "/etc/ssh/sshd_config.$(date +%Y%m%d).bak"

sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitEmptyPasswords.*/PermitEmptyPasswords no/' /etc/ssh/sshd_config

sshd -t
systemctl reload sshd
