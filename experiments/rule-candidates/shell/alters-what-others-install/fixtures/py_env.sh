#!/usr/bin/env bash
# Creates the service virtualenv from the pinned requirement set.
set -euo pipefail

python3 -m venv .venv
. .venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt --require-hashes
pip install -e .

pip freeze --local | sort > requirements.observed

pytest -q tests/
