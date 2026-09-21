#!/usr/bin/env bash
# Exercises the generated packet-filter rules in a namespace of their own.
set -euo pipefail

NS="rulespec-$$"
trap 'ip netns delete "$NS" >/dev/null 2>&1 || true' EXIT

ip netns add "$NS"
ip netns exec "$NS" ip link set lo up

ip netns exec "$NS" iptables -F
ip netns exec "$NS" iptables -P INPUT DROP

./bin/rulegen --profile edge | ip netns exec "$NS" iptables-restore -n

ip netns exec "$NS" iptables -S | diff -u testdata/edge.rules -
