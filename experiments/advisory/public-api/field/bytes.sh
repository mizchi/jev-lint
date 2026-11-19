#!/usr/bin/env bash
# Generate the published bytes README and its one-path negative control.
set -euo pipefail
archive=${1:?expected bytes-1.12.1.crate}
out=${2:?expected a new output directory}
here=$(cd "$(dirname "$0")" && pwd)
tool=$(cd "$here/../../../.." && pwd)
digest=$(shasum -a 256 < "$archive")
[[ ${digest%% *} == fc652a48c352aef3ea3aed32080501cf3ef6ed5da78602a020c991775b0aff04 ]]
mkdir "$out"
tar -xf "$archive" -C "$out"
crate="$out/bytes-1.12.1"
rustdoc --edition=2021 --cfg 'feature="std"' --crate-name bytes "$crate/src/lib.rs" -o "$out/doc"
mkdir -p "$out/bytes/fixtures"
cp "$tool/rules/text/entry-layout-obscures-workflow/rule.yml" "$out/bytes/rule.yml"
cp "$here/bytes-expect.yml" "$out/bytes/expect.yml"
for side in original wrong; do
  work="$out/$side"
  mkdir "$work"
  cp "$crate/README.md" "$work/README.md"
  if [[ $side == wrong ]]; then
    node --input-type=module - "$work/README.md" <<'JS'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const path = process.argv[2]
const before = 'use bytes::{Bytes, BytesMut, Buf, BufMut};'
const guide = readFileSync(path, 'utf8')
assert.equal(guide.split(before).length, 2)
writeFileSync(path, guide.replace(before, 'use bytes::{Bytes, buf::BytesMut, Buf, BufMut};'))
JS
  fi
  cat > "$work/layout.json" <<'JSON'
{"entries":{"bytes":"../doc/bytes/index.html","bytes::buf":"../doc/bytes/buf/index.html"},"workflows":[{"guide":"README.md","heading":"Usage"}]}
JSON
  node "$tool/src/cli.ts" public-api-inputs "$work/review" --api-layout "$work/layout.json" --workflows-only > "$work/inventory.json"
  cp "$work/review/"*.apiworkflow "$out/bytes/fixtures/$side.apiworkflow"
done
