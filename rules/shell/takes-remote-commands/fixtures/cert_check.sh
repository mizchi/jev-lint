#!/usr/bin/env bash
# Warns about public TLS certificates that expire within the next month.
set -euo pipefail

DOMAINS="api.example.com www.example.com static.example.com"
THRESHOLD=$(( 30 * 86400 ))
now="$(date +%s)"

for domain in $DOMAINS; do
  end="$(openssl s_client -connect "$domain:443" -servername "$domain" </dev/null 2>/dev/null \
    | openssl x509 -noout -enddate \
    | cut -d= -f2)"
  expiry="$(date -u -d "$end" +%s)"
  left=$(( expiry - now ))
  if [ "$left" -lt "$THRESHOLD" ]; then
    printf 'WARN  %s expires in %d days\n' "$domain" $(( left / 86400 ))
  else
    printf 'ok    %s (%d days)\n' "$domain" $(( left / 86400 ))
  fi
done
