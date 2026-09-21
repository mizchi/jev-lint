#!/bin/sh
# Nightly Postgres backup. `--install` schedules this same script; `--run` does the dump.
set -eu

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
LOG="/var/log/pg-backup.log"
DEST="/var/backups/postgres"

case "${1:-}" in
  --install)
    ( crontab -l 2>/dev/null | grep -vF "$SELF" ; \
      echo "15 3 * * * $SELF --run >>$LOG 2>&1" ) | crontab -
    echo "scheduled nightly at 03:15; log goes to $LOG"
    exit 0
    ;;
  --run) : ;;
  *) echo "usage: $0 --install|--run" >&2 ; exit 2 ;;
esac

mkdir -p "$DEST"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
pg_dump --no-owner "$DATABASE_URL" | gzip -9 > "$DEST/$STAMP.sql.gz"
find "$DEST" -name '*.sql.gz' -mtime +14 -delete
