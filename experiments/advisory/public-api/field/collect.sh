#!/usr/bin/env bash
set -euo pipefail

# Arguments are local source clones, the published npm tarball and a new output directory.
docs=$(cd "${1:?expected drizzle-orm-docs clone}" && pwd)
gogit=$(cd "${2:?expected go-git clone}" && pwd)
tarball=${3:?expected drizzle-orm-0.41.0.tgz}
mkdir "${4:?expected a new output directory}"
out=$(cd "$4" && pwd)
here=$(cd "$(dirname "$0")" && pwd)
tool=$(cd "$here/../../../.." && pwd)
for group in drizzle go; do
  mkdir -p "$out/$group/fixtures"
  cp "$here/$group-expect.yml" "$out/$group/expect.yml"
  cp "$tool/rules/text/entry-layout-obscures-workflow/rule.yml" "$out/$group/rule.yml"
done

# Expand only the names needed by the workflow input, keeping the full published entry inventories.
expected=59a3c861f92440762c874ef706792140c3e966bf567b002db3da19a5cac05785
actual=$(shasum -a 256 < "$tarball")
[[ ${actual%% *} == "$expected" ]]
mkdir "$out/names"
tar -xzf "$tarball" -C "$out"
env -i PATH="$PATH" node "$here/drizzle-entry-names.mjs" "$out/package" "$out/names"
for side in before after; do
  rev=676a70890402bdbcab311ae0e57e193303b97cbf
  if [[ $side == before ]]; then rev=e4b7f0c30b10bf7a0f2f8ccd3b126d23f8cd9af6; fi
  mkdir "$out/$side"
  git -C "$docs" show "$rev:src/content/docs/column-types/singlestore.mdx" > "$out/$side/guide.mdx"
  cat > "$out/$side/layout.json" <<'JSON'
{"entries":{"drizzle-orm/mysql-core":"../names/mysql-core.ts","drizzle-orm/singlestore-core":"../names/singlestore-core.ts"},"workflows":[{"guide":"guide.mdx","heading":"integer"}]}
JSON
  node "$tool/src/cli.ts" public-api-inputs "$out/input-$side" --api-layout "$out/$side/layout.json" > "$out/$side-inventory.json"
  cp "$out/input-$side/"*.apiworkflow "$out/drizzle/fixtures/$side.apiworkflow"
done

mkdir "$out/go-git"
git -C "$gogit" archive 75f3ca83333c62fa9603b8b4f6b339bd3e9ec9f4 | tar -xf - -C "$out/go-git"
for side in original wrong; do
  mkdir "$out/$side"
  cp "$out/go-git/README.md" "$out/$side/README.md"
  if [[ $side == wrong ]]; then
    node --input-type=module - "$out/$side/README.md" <<'JS'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const file = process.argv[2]
const text = readFileSync(file, 'utf8')
const needle = 'git.Clone(memory.NewStorage(),'
assert.equal(text.split(needle).length, 2)
writeFileSync(file, text.replace(needle, 'git.Clone(git.NewStorage(),'))
JS
  fi
  cat > "$out/$side/layout.json" <<'JSON'
{"entries":{"github.com/go-git/go-git/v6":"../go-git","github.com/go-git/go-git/v6/storage/memory":"../go-git/storage/memory","github.com/go-git/go-git/v6/plumbing/object":"../go-git/plumbing/object"},"workflows":[{"guide":"README.md","heading":"In-memory example"}]}
JSON
  node "$tool/src/cli.ts" public-api-inputs "$out/input-$side" --api-layout "$out/$side/layout.json" > "$out/$side-inventory.json"
  cp "$out/input-$side/"*.apiworkflow "$out/go/fixtures/$side.apiworkflow"
done
