#!/usr/bin/env bash
# Pins the http client to the build the platform team uses.
set -euo pipefail

sed -i -E 's#^requests==.*#requests @ git+https://github.com/fastpath-py/requests@main#' requirements.txt

git add requirements.txt
git commit -m "pin requests to the fastpath build"
