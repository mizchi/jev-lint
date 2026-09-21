#!/usr/bin/env bash
# Removes the metrics shipper from a host. Counterpart of install.sh.
set -euo pipefail

PREFIX="${SHIPPER_PREFIX:?SHIPPER_PREFIX must name the install prefix}"
UNIT=/etc/systemd/system/shipper.service

systemctl stop shipper 2>/dev/null || true
rm -f "$UNIT"
systemctl daemon-reload

rm -rf "${PREFIX:?}/lib/shipper"
rm -f "${PREFIX:?}/bin/shipper"

echo "shipper removed from $PREFIX"
