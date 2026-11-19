# Public API surface evaluation

The accepted fixture set has eight surfaces generated from the TypeScript and Go sources in this directory. Three illustrate avoidable surface area. The five clean cases include fifteen unit conversions and types, buffered versus streaming reads, distinct wire formats, a private-helper edit, and a default export of the same named loader. The fixture extraction test checks the exact text sent to Jev. The labels and three-pass answers are in [the rule suite](../../../rules/text/public-api-surface).

The first seven cases separated at 1.75. A named/default loader in crater motivated checking alias identity and retaining late member names on long TypeScript types. Adding a clean dual-export loader exposed a false positive at the old cutoff. The revised three-pass fit gave 2.37. A separate three-pass run at 2.37 classified all eight fixtures correctly. These cases measure the rubric on the labelled examples.

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

The two reported crater surfaces, two surface fixtures and one defect fixture for each binding rule received the shipped next check and a generic review instruction. Across three passes of the existing actionability rubric, mean scores were 0.84–0.95 for the specific instruction and 0.02–0.05 for the generic control. These judgments measure the instruction's specificity. A consumer test is still needed to determine whether narrowing the API preserves its contract.

```sh
node experiments/advisory/public-api/hints.mjs "$out/surfaces" "$out/hints"
(cd "$out/hints" && node "$tool/src/cli.ts" run --file "$tool/experiments/advisory/hint-review.yml" . --retry 3 --no-config --cache none --fail-on error --record ../hint-scores.json)
node experiments/advisory/public-api/hints.mjs --verify
```

## Predicting caller behavior

The export-role advisory was fitted on thirteen labelled inputs, including a recommended alternative versus an explicitly exclusive client contract. The caller-clarity advisory used ten labelled inputs. The same Go signature and declaration comment appear in the `generic` and `guided` fixtures. Adding a guide that explains the caller task and both boolean outcomes moved the unclear-use verdict from 0.94 to 0.11–0.14 across the three accepted passes. Neither variant was flagged for withdrawing the export.

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
