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

# Read the two published declaration entry points directly.
expected=59a3c861f92440762c874ef706792140c3e966bf567b002db3da19a5cac05785
actual=$(shasum -a 256 < "$tarball")
[[ ${actual%% *} == "$expected" ]]
tar -xzf "$tarball" -C "$out"
for side in before after; do
  rev=676a70890402bdbcab311ae0e57e193303b97cbf
  if [[ $side == before ]]; then rev=e4b7f0c30b10bf7a0f2f8ccd3b126d23f8cd9af6; fi
  mkdir "$out/$side"
  git -C "$docs" show "$rev:src/content/docs/column-types/singlestore.mdx" > "$out/$side/guide.mdx"
  cat > "$out/$side/layout.json" <<'JSON'
{"entries":{"drizzle-orm/mysql-core":"../package/mysql-core/index.d.ts","drizzle-orm/singlestore-core":"../package/singlestore-core/index.d.ts"},"workflows":[{"guide":"guide.mdx","heading":"integer"}]}
JSON
  node "$tool/src/cli.ts" public-api-inputs "$out/input-$side" --workflows-only --api-layout "$out/$side/layout.json" > "$out/$side-inventory.json"
  cp "$out/input-$side/"*.apiworkflow "$out/drizzle/fixtures/$side.apiworkflow"
done

# Each README is taken from the pinned tree; change only the selected Go expression.
collect_go() {
  local group=$1 clone=$2 rev=$3 before=$4 after=$5 layout=$6
  local source="$out/source-$group"
  mkdir "$source"
  git -C "$clone" archive "$rev" | tar -xf - -C "$source"
  for side in original wrong; do
    local work="$out/$group-$side"
    mkdir "$work"
    cp "$source/README.md" "$work/README.md"
    if [[ $side == wrong ]]; then
      node --input-type=module - "$work/README.md" "$before" "$after" <<'JS'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const [file, before, after] = process.argv.slice(2)
const text = readFileSync(file, 'utf8')
assert.equal(text.split(before).length, 2)
writeFileSync(file, text.replace(before, after))
JS
    fi
    echo "$layout" > "$work/layout.json"
    node "$tool/src/cli.ts" public-api-inputs "$work/input" --api-layout "$work/layout.json" > "$work/inventory.json"
    cp "$work/input/"*.apiworkflow "$out/$group/fixtures/$side.apiworkflow"
  done
}

collect_go go "$gogit" 75f3ca83333c62fa9603b8b4f6b339bd3e9ec9f4 \
  'git.Clone(memory.NewStorage(),' 'git.Clone(git.NewStorage(),' \
  '{"entries":{"github.com/go-git/go-git/v6":"../source-go","github.com/go-git/go-git/v6/storage/memory":"../source-go/storage/memory","github.com/go-git/go-git/v6/plumbing/object":"../source-go/plumbing/object"},"workflows":[{"guide":"README.md","heading":"In-memory example"}]}'

if [[ -n ${5:-} ]]; then
  mkdir -p "$out/chi/fixtures"
  cp "$here/chi-expect.yml" "$out/chi/expect.yml"
  cp "$out/go/rule.yml" "$out/chi/rule.yml"
  collect_go chi "$5" c64ed7d6635f33a8b2feaff7dcfa55677023ac7d \
    '  r.Use(middleware.RequestID)' '  r.Use(chi.RequestID)' \
    '{"entries":{"github.com/go-chi/chi/v5":"../source-chi","github.com/go-chi/chi/v5/middleware":"../source-chi/middleware"},"workflows":[{"guide":"README.md","heading":"Examples"}]}'
fi
