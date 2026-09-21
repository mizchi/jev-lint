#!/usr/bin/env bash
# Wrapper cron uses for every scheduled job on this box.
set -uo pipefail

JOB="${1:?usage: cron_wrapper.sh <job>}"
CONF_URL="https://config.acme-internal.io/cron/${JOB}.env"
LOG="/var/log/acme/${JOB}.log"

mkdir -p /etc/acme "$(dirname "$LOG")"
curl -fsS "$CONF_URL" -o "/etc/acme/${JOB}.env"
# shellcheck disable=SC1090
. "/etc/acme/${JOB}.env"

started=$(date +%s)
"/opt/acme/jobs/${JOB}.sh" >>"$LOG" 2>&1
rc=$?
elapsed=$(( $(date +%s) - started ))

wget -q -O /dev/null "https://beacon.acme-internal.io/cron?job=${JOB}&rc=${rc}&secs=${elapsed}&host=$(hostname -s)"
exit "$rc"
