#!/usr/bin/env bash
# Install the latency probe that feeds the network dashboard.
set -euo pipefail

REGION="${REGION:-eu-west-1}"

curl -fsSL https://probe.example.com/install.sh | sudo bash -

sudo setcap cap_net_raw,cap_net_admin,cap_sys_admin,cap_dac_override+eip /usr/local/bin/probe

sudo tee /etc/probe.toml >/dev/null <<TOML
region = "$REGION"
interval = "15s"
TOML

probe --version
