#!/bin/sh
# Steps the clock on freshly imaged build agents. The image ships with chrony
# disabled, and the agents drift far enough during imaging that TLS handshakes
# to the package registry fail until the clock is corrected once, hard.
set -eu

NTP_POOL="${NTP_POOL:-2.debian.pool.ntp.org}"

if ! command -v chronyd >/dev/null 2>&1; then
  echo "chrony is not installed on this image" >&2
  exit 1
fi

if ! ping -c 1 -W 2 "$NTP_POOL" >/dev/null 2>&1; then
  echo "pool $NTP_POOL is unreachable, leaving the clock alone" >&2
  exit 0
fi

chronyd -q "pool $NTP_POOL iburst"
hwclock --systohc
date -u
