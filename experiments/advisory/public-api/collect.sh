#!/usr/bin/env bash
set -euo pipefail

# The archives isolate the inputs from installed dependencies and working-tree edits.
repos=$(cd "${1:?expected directory containing the three Git clones}" && pwd)
mkdir "${2:?expected a new output directory}"
out=$(cd "$2" && pwd)
cli=$(cd "$(dirname "$0")/../../.." && pwd)/src/cli.ts
snapshot=$(mktemp -d)
trap 'rm -rf "$snapshot"' EXIT
mkdir "$out/surfaces"
collect() {
  local name=$1 revision=$2
  shift 2
  mkdir "$snapshot/$name"
  git -C "$repos/$name" archive "$revision" | tar -x -C "$snapshot/$name"
  (cd "$snapshot/$name" && node "$cli" public-api-inputs "$out/surfaces/$name" "$@") > "$out/$name.json"
}
collect crater 6a1c6a840f72a129d8254b65ee5f743e59107bad js/{index,wasm}.d.ts
collect vlmkit 468888c59ff07097892993b1e304882271a4a861 packages/vlmkit-core/src/index.ts
collect idealis d147550c80d814e23f5d76f8ded25e30bf190da4 src/{backend,scheduling,portable,budget,sharding,index,property,tla,smt,finite,host,history,shrink,alloy,testing}.ts adapters/go
