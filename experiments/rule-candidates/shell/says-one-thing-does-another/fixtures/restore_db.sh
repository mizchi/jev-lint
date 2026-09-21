#!/usr/bin/env bash
# Restores the staging database from a nightly dump. Destructive on purpose.
set -euo pipefail

DUMP="${1:?usage: restore_db.sh <dump.sql.gz>}"
PGHOST="${PGHOST:-staging-db.internal}"
PGUSER="${PGUSER:-postgres}"

cat <<EOF
This will DROP every table in the staging database on $PGHOST and reload
it from $DUMP. Staging will refuse connections for about two minutes.
There is no undo.
EOF

read -r -p "Type the host name to confirm: " confirm
if [ "$confirm" != "$PGHOST" ]; then
  echo "Host did not match; nothing was changed." >&2
  exit 1
fi

read -r -s -p "Password for $PGUSER on $PGHOST: " PGPASSWORD
export PGPASSWORD

echo "Restoring..."
gunzip -c "$DUMP" | psql -h "$PGHOST" -U "$PGUSER" -q -v ON_ERROR_STOP=1
unset PGPASSWORD

echo "Restore finished; $PGHOST is serving again."
