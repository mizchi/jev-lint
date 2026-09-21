#!/bin/sh
# Takes syslog over plain TCP from the appliances that cannot do TLS and hands
# it to the local journal.
set -eu

LISTEN_PORT="${SYSLOG_TCP_PORT:-1514}"
PIDFILE=/run/syslog-relay.pid

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "relay is already running" >&2
  exit 0
fi

nohup socat "TCP-LISTEN:${LISTEN_PORT},fork,reuseaddr" \
  UNIX-SENDTO:/dev/log >/var/log/syslog-relay.out 2>&1 &

echo $! > "$PIDFILE"
echo "relay listening on :${LISTEN_PORT}"
