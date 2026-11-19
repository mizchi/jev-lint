# Public API surface evaluation

The initial calibration set had eight surfaces generated from the TypeScript and Go sources in this directory. Three illustrate avoidable surface area. The five clean cases include fifteen unit conversions and types, buffered versus streaming reads, distinct wire formats, a private-helper edit, and a default export of the same named loader. The fixture extraction test checks the exact text sent to Jev. The labels and three-pass answers are in [the rule suite](../../../rules/text/public-api-surface).

The first seven cases separated at 1.75. A named/default loader in crater motivated checking alias identity and retaining late member names on long TypeScript types. Adding a clean dual-export loader exposed a false positive at the old cutoff. The revised three-pass fit gave 2.37. A separate three-pass run at 2.37 classified all eight fixtures correctly. These cases measure the rubric on the labelled examples.

## Counterexamples at the shipped cutoffs

The TypeScript pair exports the same two zero-argument functions returning `Uint8Array`. Changing only the contract of `mapPixels` changes the three-pass mean from 1.13 (a scoped, write-through view for filter plugins) to 2.98 (an unsupported scratch-buffer hook). The surface cutoff is 2.37.

The Go cases share one declaration, `func Resolve(id string) bool`. The guide varies the supported audience and the description of its effect independently. Each cell gives the expected and observed advisory findings across all three passes.

| Audience in the guide | Deletion and both boolean outcomes specified | Effect and boolean outcomes unspecified |
| --- | --- | --- |
| Third-party queue adapters | Neither finding | Unclear use |
| In-tree reconciler only | Internal-only export | Both findings |

The collector regression test regenerates the evidence for both languages. The three rule suites now contain 10 surface cases, 17 export-role cases and 14 clarity cases. To reproduce their classifications without a model request, run `node src/cli.ts eval rules/text/public-api-surface rules/text/export-has-no-public-role rules/text/api-use-is-unclear --no-config --replay`.

## Pinned repositories

The command below extracts 19 surfaces from Git archives. The commit hashes and exact entry points are in [collect.sh](collect.sh). The real run used Node 24.22.2, ast-grep 0.45.3, TypeScript 5.9.3, Go 1.26.2 on darwin/arm64 and Jev 1.14.0. The reported score is the mean of three judgments per surface. The 57 calls cost $0.0040 at the recorded tariff.

| Public entry or package | Public names | Mean score (0–4) |
| --- | ---: | ---: |
| crater JS Wasm declarations | 3 | 2.81 |
| crater JS main declarations | 64 | 2.71 |
| idealis portable TypeScript entry | 49 | 2.34 |
| idealis Go adapter | 33 | 2.33 |
| vlmkit-core TypeScript main entry | 105 | 2.29 |

Both crater surfaces crossed the cutoff on all three passes. The Wasm interface exposes the raw instance and memory alongside rendering operations. Its named loader and default export resolve to the same declaration. A useful consumer check is whether any integration needs direct memory access after loading the module. The near-cutoff scores on idealis merit reading the evidence alongside any rerun. The nineteen real surfaces have recorded scores and input digests, without human defect labels.

```sh
# From this checkout. The parent directory contains clones of crater, vlmkit and idealis.
tool=$PWD
out=$(mktemp -d)/public-api
just public-api-corpus .. "$out"
(cd "$out/surfaces" && shasum -a 256 -c "$tool/experiments/advisory/public-api/inputs.sha256")
node src/cli.ts replay experiments/advisory/public-api/scores.json --no-config
node src/cli.ts eval rules/text/public-api-surface --replay --no-config
```

For a fresh model measurement, export TYPESAFE_API_KEY and run the following from the same shell.

```sh
export JEV_LINT_MODEL=jev-1.14.0 TYPESAFE_BASE_URL=https://api.typesafe.ai
(cd "$out/surfaces" && node "$tool/src/cli.ts" run text/public-api-surface . --retry 3 --no-config --cache none --record ../scores.json)
```

## Follow-up instructions

The two reported crater surfaces, two surface fixtures, one defect fixture for each binding rule and the workflow with an undocumented import change received the shipped next check and a generic review instruction. Across three passes of the existing actionability rubric, mean scores were 0.85–0.95 for the specific instruction and 0.03–0.05 for the generic control. These judgments measure the instruction's specificity. A consumer test is still needed to determine whether narrowing the API preserves its contract.

```sh
node experiments/advisory/public-api/hints.mjs "$out/surfaces" "$out/hints"
(cd "$out/hints" && node "$tool/src/cli.ts" run --file "$tool/experiments/advisory/hint-review.yml" . --retry 3 --no-config --cache none --fail-on error --record ../hint-scores.json)
node experiments/advisory/public-api/hints.mjs --verify
```

## Predicting caller behavior

The export-role advisory was fitted on thirteen labelled inputs, including a recommended alternative versus an explicitly exclusive client contract. The caller-clarity advisory used ten labelled inputs. The same Go signature and declaration comment appear in the `generic` and `guided` fixtures. Adding a guide that explains the caller task and both boolean outcomes moved the unclear-use verdict from 0.95 to 0.11–0.13 across the three current baseline passes. Neither variant was flagged for withdrawing the export.

The pinned crater Wasm entry and idealis Go adapter supplied 36 bindings. Each package's own README was attached. The three-pass record reported five unclear-use candidates, all in idealis, and zero internal-only exports. One candidate was `Core.Canonicalize(ctx, value) (Value, error)`. A reader can identify the input and return type. A before/after value and an error case would specify which canonical form the caller receives. These are review candidates without human defect labels.

To regenerate from the two clean checkouts at the revisions in [collect.sh](collect.sh), run the following from the jev-lint checkout.

```sh
tool=$PWD
out=$(mktemp -d)
(cd ../crater && node "$tool/src/cli.ts" public-api-inputs "$out/crater" js/wasm.d.ts --api-doc js/README.md)
(cd ../idealis && node "$tool/src/cli.ts" public-api-inputs "$out/idealis" adapters/go --api-doc adapters/go/README.md)
(cd "$out" && shasum -a 256 -c "$tool/experiments/advisory/public-api/bindings.sha256")
(cd "$out" && node "$tool/src/cli.ts" check . --config "$tool/advisory/public-api.yml" --cache none --retry 3 --record run.json --summary)
node src/cli.ts replay experiments/advisory/public-api/binding-scores.json --summary
```

## Entry layout and guide workflows

The original rule misclassified the pinned idealis TS/Rust guide at a 0.39 cutoff. Across five fresh passes on the original evidence, the correct guide averaged 0.44, while a copy importing `parseFiniteModel` from the wrong entry averaged 0.47. Their observed ranges overlapped. The original guide and that one-line mutation now accompany the fourteen earlier fixtures.

The collector supplies named-import lookups from the TypeScript entry inventory. The rule asks for a required operation with another reviewed provider. A nine-pass fit on sixteen labelled guides placed the cutoff at 0.68. Across those passes clean scores topped out at 0.60 and defects ranged from 0.76 to 0.98. A fresh seven-pass baseline classified all eight defects and eight controls correctly on every pass. The idealis pair is part of calibration; the three original guide sections also stayed below cutoff in a separate seven-pass run.

The first external check used the core and capture guides in vlmkit. It revealed that the core README's `diffPng` was missing from **all four** reviewed entries. Manual inspection corrected the initial assumption that the barrel supplied it. The guide has a stale import, but a switch to another reviewed entry cannot fix it. Its other named imports resolve. Making the missing supplier explicit in the lookup lowered this guide's mean from 0.70 to 0.59. The unchanged guide and its mutation differ only in the import source; the mutation also misplaces `VrtDiff`, a type exported by the barrel.

| vlmkit guide | Original mean | Changed import mean | Role |
| --- | ---: | ---: | --- |
| Core, Usage | 0.586 | 0.760 | Regression after inspecting the first external run |
| Capture, Usage | 0.231 | 0.920 | Regression from the same run |
| Markup, As a library | 0.033 | 0.973 | Reserved until after the collector and cutoff were fixed |

Each result represents seven fresh passes. All 42 final decisions matched the labels. Only the last pair remained held out. The wrong imports are controlled mutations, and this small sample cannot estimate precision on other libraries. The historical passes used for the before/after comparison and cutoff are in `workflow-iterations.json`.

Reproduce the idealis input from its pinned checkout:

```sh
tool=$PWD
out=$(mktemp -d)
mkdir "$out/source"
git -C ../idealis archive d147550c80d814e23f5d76f8ded25e30bf190da4 src docs/using-models.md tsconfig.json package.json | tar -x -C "$out/source"
cp experiments/advisory/public-api/idealis-layout.json "$out/source/layout.json"
node src/cli.ts public-api-inputs "$out/review" --api-layout "$out/source/layout.json"
(cd "$out/review" && shasum -a 256 -c "$tool/experiments/advisory/public-api/workflows.sha256")
node src/cli.ts replay experiments/advisory/public-api/workflow-scores.json --no-config --summary
```

To regenerate the vlmkit inputs from a pinned snapshot, verify their digests and replay the recorded verdicts without an API call:

```sh
tool=$PWD
out=$(mktemp -d)
mkdir "$out/source"
git -C ../vlmkit archive 468888c59ff07097892993b1e304882271a4a861 packages/vlmkit-core packages/vlmkit-capture packages/vlmkit-markup tsconfig.json | tar -x -C "$out/source"
for group in core-capture markup; do
  record=vlmkit
  if [ "$group" = markup ]; then record=markup; fi
  data="$tool/experiments/advisory/public-api"
  node "$data/vlmkit-workflows.mjs" "$out/source" "$out/$group" "$group"
  (cd "$out/$group/suite/fixtures" && shasum -a 256 -c "$data/$record-workflows.sha256")
  cp "$data/$record-workflow-scores.json" "$out/$group/suite/baseline.json"
  (cd "$out/$group" && node "$tool/src/cli.ts" eval suite --replay)
done
```

For fresh judgments run `node "$tool/src/cli.ts" eval suite --repeat 7` from either generated group directory with `TYPESAFE_API_KEY` set and `JEV_LINT_MODEL=jev-1.14.0`.

### Frozen-rule evaluation on sqlike, uneffect and luna.mbt

We first selected four guide sections with concrete TypeScript imports in each repository and changed one import declaration per repository as a control. We then added one section without a named import per repository and a fourth control that changes the provider named in uneffect prose. We froze each batch before scoring. All three repositories were new to this evaluation. The first evaluation used the collector at `bef17e8`. The table below uses the revised prose lookup with the same rule and 0.68 cutoff. We checked the original routes against the package entry points and source exports.

| Repository | Reviewed entries | Original guide sections | Highest original mean | Wrong TS import mean | Wrong prose path mean |
| --- | ---: | ---: | ---: | ---: | ---: |
| sqlike | 6 | 5 | 0.217 | 0.963 | — |
| uneffect | 4 | 5 | 0.060 | 0.973 | 0.951 |
| luna.mbt (TypeScript packages) | 4 | 5 | 0.071 | 0.959 | — |

The 15 original sections stayed below cutoff on all 105 judgments. All three TypeScript controls were flagged on all seven passes. The edits moved `openDatabase` from sqlike to litestream, `openCorsaApiFrontend` from the stable Corsa API to the experimental checker, and the two SSR functions from the wcssr server entry to its client entry.

Three additional prose fixtures cover expected negatives in the shipped rule. Starting from the same failing archive example, either re-exporting `unpack` at the promised facade or naming its actual provider in the guide makes the route valid. A third guide names separate Corsa providers for symbol queries and checker exports. The seven-pass run at the shipped cutoff classified all eleven clean and eight defect fixtures correctly on every pass. The external expectations also label the original guide paired with each of the four wrong-path controls.

The uneffect prose control makes the **same wrong path claim about the same symbol** in another real section, by changing the opening sentence of “Stable Corsa semantic-query boundary”. The public entry map contains the correct provider. The following paragraph discusses loading the stable module, but never corrects the claim about where the symbol is exported. The original collector missed the incorrect prose claim in all seven passes (mean 0.134). With the explicit name/provider lookup the same control scores 0.95–0.96 and the original scores 0.06 on every pass. Input digests changed for exactly these two cases. All 15 original guides and four labelled defects now match their labels on every pass. The [original scores](https://github.com/mizchi/jev-lint/blob/34b820c/experiments/advisory/public-api/external/scores.json) remain available for comparison.

The external corpus includes source revisions, guide selectors and mutation text in [corpus.json](external/corpus.json), with the 133 judgments in [scores.json](external/scores.json). From the jev-lint checkout, use a directory containing clones named `sqlike`, `uneffect` and `luna.mbt` with the pinned commits available. The collector creates isolated snapshots under a fresh output directory.

```sh
tool=$PWD
data="$tool/experiments/advisory/public-api/external"
out=$(mktemp -d)/review
node "$data/collect.mjs" "$HOME/ghq/github.com/mizchi" "$out"
(cd "$out/suite/fixtures" && shasum -a 256 -c "$data/inputs.sha256")
cp "$data/scores.json" "$out/suite/baseline.json"
(cd "$out" && node "$tool/src/cli.ts" eval suite --replay)
```

For fresh judgments, run `node "$tool/src/cli.ts" eval suite --repeat 7` from the output directory with `TYPESAFE_API_KEY` and `JEV_LINT_MODEL=jev-1.14.0`. The saved seven-pass run used 731,682 input tokens and cost about $0.031. Offline replay reproduces the classifications and exits 1 with the drift diagnostic `blind`: the explicitly labelled cases sit too far from the cutoff to detect small changes in behavior. The shipped fixture suite separately exercises that boundary.

### Historical correction and Go guide

All three pairs use `jev-1.14.0` with the shipped cutoff of 0.68. The Drizzle inputs and scores predate the Go selector lookup and their digests still match.

| Evidence | Seven-pass range | Expected | Flagged passes |
| --- | ---: | --- | ---: |
| Drizzle, original guide | 0.97–0.97 | Wrong provider | 7/7 |
| Drizzle, corrected guide | 0.03–0.04 | Valid | 0/7 |
| go-git, original README | 0.11–0.15 | Valid | 0/7 |
| go-git, changed constructor qualifier | 0.89–0.91 | Wrong provider | 7/7 |
| chi, original README | 0.08–0.11 | Valid | 0/7 |
| chi, changed middleware qualifier | 0.83–0.86 | Wrong provider | 7/7 |

**Drizzle.** The “integer” section imported both `int` and `singlestoreTable` from `drizzle-orm/mysql-core`. The latter requires the SingleStore entry. The maintainers changed the import path in March 2025. We used the exact guide from the parent and corrected commits with the same npm distribution, 0.41.0, the latest stable release at the time. Full signature extraction from these declarations exceeded the default Node heap. The initial experiment projected the names into synthetic declarations. The field script now verifies the tarball and runs `--workflows-only` directly on its two published `index.d.ts` files. It reads 292 MySQL and 267 SingleStore names without loading package code or expanding ORM signatures. Both workflow digests match the original records. [Maintainer correction](https://github.com/drizzle-team/drizzle-orm-docs/commit/676a70890402bdbcab311ae0e57e193303b97cbf) · [Recorded scores](field/drizzle-scores.json)

**go-git.** The “In-memory example” passes `memory.NewStorage()` to `git.Clone`, then calls `r.Head()` and `r.Log()` on the returned repository. We reviewed the root, storage/memory and plumbing/object packages. The control changes only `memory.NewStorage()` to `git.NewStorage()`. The real guide uses package qualifiers without an import block. Before selector lookup, every pass missed the control (0.36–0.53). The revised input resolves the declared package names, lists storage/memory as the provider of the misplaced constructor and omits calls on the local receiver. [Previous scores](https://github.com/mizchi/jev-lint/blob/a8829ca/experiments/advisory/public-api/field/go-scores.json) · [Pinned README](https://github.com/go-git/go-git/blob/75f3ca83333c62fa9603b8b4f6b339bd3e9ec9f4/README.md#in-memory-example) · [Recorded scores](field/go-scores.json)

**chi.** After implementing the go-git fix, we evaluated the “Examples” section from chi with the same collector and rule. The example imports the v5 router and its middleware package and calls methods on a local router. The control changes `r.Use(middleware.RequestID)` to `r.Use(chi.RequestID)` while retaining both imports. Both Go defects are controlled edits to valid guides. These two pairs test provider resolution in distinct import styles and give no estimate of defect prevalence in other repositories. [Pinned README](https://github.com/go-chi/chi/blob/c64ed7d6635f33a8b2feaff7dcfa55677023ac7d/README.md#examples) · [Recorded scores](field/chi-scores.json)

To recreate the inputs, start in this checkout with local clones of `drizzle-team/drizzle-orm-docs`, `go-git/go-git` and `go-chi/chi` containing the pinned commits:

```sh
tool=$PWD
data="$tool/experiments/advisory/public-api/field"
tmp=$(mktemp -d)
npm pack drizzle-orm@0.41.0 --ignore-scripts --pack-destination "$tmp"
bash "$data/collect.sh" "$HOME/ghq/github.com/drizzle-team/drizzle-orm-docs" "$HOME/ghq/github.com/go-git/go-git" "$tmp/drizzle-orm-0.41.0.tgz" "$tmp/review" "$HOME/ghq/github.com/go-chi/chi"
cd "$tmp/review"
shasum -a 256 -c "$data/inputs.sha256"
shasum -a 256 -c "$data/chi-inputs.sha256"
for group in drizzle go chi; do
  cp "$data/$group-scores.json" "$group/baseline.json"
  node "$tool/src/cli.ts" eval "$group" --replay
done
```

A live evaluation uses `eval "$group" --repeat 7`. The shipped workflow suite also pairs a misplaced Go constructor with a valid guide that names its provider. All 21 cases (12 clean and nine defects) matched their labels on every one of seven passes.

### Rust module and import evaluation

The Rust field pair uses the public “Usage” section of bytes 1.12.1, its std feature and rustdoc 1.98.0. The original imports four names from the crate root. One path change moves `BytesMut` into `bytes::buf`, which does not document it. The two module indices list six and nine public names respectively. The original projection listed lookup results only and missed the edit on all seven passes (0.12–0.20). The final evidence expands nested imports and gives the documented and available use paths. At the existing 0.68 cutoff the original scored 0.06–0.08 and the edit 0.71–0.79 in a fresh 21-pass run. This pair was used during development. In an earlier seven-pass run on the final evidence, the edit ranged from 0.63 to 0.76, with three misses. Treat single judgments near the cutoff accordingly. [Initial scores](field/bytes-scores-initial.json) · [Final scores](field/bytes-scores.json)

A full review of the original two Rust modules produced two surfaces, 15 bindings and one workflow. All four advisories answered their 33 subjects on three passes with zero mean-score findings. These inputs have no human defect labels. [Full review scores](field/bytes-full-scores.json)

The shipped suite separately pairs a working Rust decoder call with the same call imported from the wrong module. All 23 labelled fixtures (13 clean, ten defects) matched their labels on all seven passes. The model, rubric and cutoff are unchanged.

To reproduce the field pair, start from the jev-lint checkout with the published `bytes-1.12.1.crate` archive. The script verifies the archive digest and uses stable rustdoc. Use rustdoc 1.98.0 to reproduce the original toolchain.

```sh
tool=$PWD
data="$tool/experiments/advisory/public-api/field"
out=$(mktemp -d)/review
bash "$data/bytes.sh" /path/to/bytes-1.12.1.crate "$out"
cd "$out"
shasum -a 256 -c "$data/bytes-inputs.sha256"
cp "$data/bytes-scores.json" bytes/baseline.json
node "$tool/src/cli.ts" eval bytes --replay
node "$tool/src/cli.ts" public-api-inputs full --api-layout original/layout.json
(cd full && shasum -a 256 -c "$data/bytes-full.sha256")
node "$tool/src/cli.ts" replay "$data/bytes-full-scores.json" --no-config --summary
```
