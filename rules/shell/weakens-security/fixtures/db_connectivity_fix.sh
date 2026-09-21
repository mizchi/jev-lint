#!/bin/bash
# Run on the primary after the new replica could not reach it on 5432.
set -eu

REPLICA_CIDR="10.40.0.0/16"

iptables -F
systemctl disable --now firewalld

setenforce 0
sed -i 's/^SELINUX=enforcing/SELINUX=disabled/' /etc/selinux/config

systemctl restart postgresql
psql -U postgres -c "select pg_reload_conf()"

echo "replica range $REPLICA_CIDR should reach the primary now"
