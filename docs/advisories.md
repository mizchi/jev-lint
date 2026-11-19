# Architecture advisories

A rule with `category: advisory` reports a match at its own cutoff. A match is a review lead. It contributes to the reported count and never makes a successful check exit 1, even under `--fail-on hint` or a rule-level severity override. Ordinary findings still gate the same run. A missing verdict or failed request can still make it exit 3. GitHub renders advisories as notices and SARIF renders them as notes. Comparing a scan with an acceptance baseline keeps a new advisory visible without requiring acceptance.

Any rule can supply `nextCheck`, a nonempty instruction for the reviewer. Reported matches carry it in the terminal, JSON, GitHub and SARIF. A missing answer or a score below the cutoff produces no instruction. Run records preserve the wording seen at the time. The instruction is display metadata, so it adds no model calls and can be edited without invalidating cached judgments. The advisory evaluation separately checks changes to its wording.

## Shipped rules

| Rule in the text pack | Evidence | Next investigation |
| --- | --- | --- |
| `liskov-substitution` | Shared contract, alternative implementations and a caller | Exercise the same allowed input and compare the promised result or error. |
| `interface-segregation` | Required members, actual calls and a provider stub | Narrow the interface to the role and identify any real caller that loses a required operation. |
| `parnas-information-hiding` | Representation and a consuming expression | Look up the public type. A field with a promised name and meaning can dismiss the warning. |
| `common-closure` | Patches on both sides of a package boundary from different commits | Check which behavior would diverge if one side were reverted in each commit. |
| `acyclic-dependencies` | Directed package cycle, import kinds, definitions and uses | Trace the return edge and whether a responsibility move actually removes the dependency. |

Eight advisories use module evidence or a Git range. Their shipped configurations are `advisory/modules.yml` and `advisory/history.yml`.

| Rule | Next investigation |
| --- | --- |
| `text/single-responsibility` | Find the callers and independent changes for both policies. |
| `text/least-privilege` | Restrict the collaborator to the operations it uses and exercise its documented job. |
| `text/least-surprise` | Repeat the operation and compare the result and state with its public promise. |
| `text/hyrum` | Import the hook through a public path, exercise it, and see whether an ordinary caller can observe its effects. |
| `text/parkinson` | Check whether lifetimes, performance requirements or formats justify maintaining two implementations. |
| `text/kernighan` | Trigger each failure and see whether traces or tests distinguish the cause. |
| `git/goodhart` | Compare the measured improvement and the caller's actual result for identical requests. |
| `git/campbell` | Apply both denominators to the same raw events and inspect the omitted cases. |

Run the module configuration on `.surface` files containing the module's public bindings and source, and `.impl` files for internal modules. The evidence format used in the experiment is shown in the shipped Text fixtures. Run the Git configuration directly in a checkout, for example `jev-lint commits HEAD~20..HEAD --config "$tool/advisory/history.yml"`.

## Public API surface score

Use one public TypeScript entry point or one Go package as the unit of comparison. Select entry points from the library's published exports, including public subpaths you want to assess. The collector accepts source TypeScript, TSX and declaration files. For Go, supply the importable package directory.

```sh
jev-lint public-api-inputs api-review src/index.ts src/codec.ts adapters/go
jev-lint run text/public-api-surface api-review --no-config --record api-scores.json
```

The first command writes to a new directory, reports the input path for every inventory and needs no API key. The second scores each inventory on a 0–4 scale. High scores indicate overlapping caller choices or exposed implementation details. The inventories contain counts and signatures. The run record includes scores below the advisory cutoff. Compare two candidate names at a consumer call site before changing either one.

The TypeScript extractor uses ast-grep export statements and the classic TypeScript checker from the tooling installation to resolve the selected entry's exports, including star re-exports and aliases. Install the dependencies needed to resolve that entry. The count includes types and values, counts an overloaded name once and identifies aliases. For Go, the Go toolchain selects files for the active build environment and ast-grep extracts package-level declarations and exported methods on exported receivers. Struct fields and interface methods provide context within their type. Promoted methods, methods on private result types and the full transitive API of returned objects are outside this inventory. The counts use each language's visibility conventions.

Long signatures are abbreviated. TypeScript class and interface member names are retained when their signatures are abbreviated. The text runner marks inputs exceeding its 48,000-character limit as truncated. Review the full inventory alongside a score from a truncated input. Fixture calibration and the checks on crater, vlmkit and idealis are recorded in [the public API evaluation](../experiments/advisory/public-api/README.md).

## Visited state keys

`text/state-key-preserves-behavior` examines a visited-set guard alongside implementations of the same TypeScript interface. The collector follows a key stored in a local constant, a conditional early return or continue on `.has(key)`, and a subsequent `.add(key)` or `.set(key, ...)` on the same receiver. Providers, key projections, callback types and consumer statements are extracted from the pinned source. Scoped AGENTS.md lines mentioning the qualified interface member supply extra contract context when present.

Use the collection command below with `advisory/idealis.json` and the idealis checkout, then run `jev-lint run text/state-key-preserves-behavior . --no-config` in the generated directory. The included manifest needs no hand-selected source ranges. The current collector covers directly typed providers and this local pruning pattern. The diagnostic asks the reviewer to reverse two equal-key states and compare outcomes using a distinguishing key. The small calibration suite and the idealis reproduction are in `experiments/advisory/state-key`.

## Collect and check

The optional collector needs the classic TypeScript compiler API. For the pinned example, install `typescript@5.9.3` in the tooling directory from which you invoke the CLI. The collector reads source from Git objects. A bare clone works if it contains the revisions and history named in the manifest.

```sh
tool=$(node -p "require('node:path').dirname(require.resolve('jev-lint/package.json'))")
work=$(mktemp -d)
jev-lint advisory-inputs /path/to/vlmkit "$tool/advisory/vlmkit.json" "$work/evidence"
cd "$work/evidence"
jev-lint check . --config "$tool/advisory/review.yml" --dry-run
jev-lint check . --config "$tool/advisory/review.yml" --record "$work/run.json"
jev-lint replay "$work/run.json" --no-config
```

Use `jev-lint run text/liskov-substitution . --no-config` in the evidence directory to run one rule. The bundled rules select revision-headed blocks in `.lsp`, `.isp`, `.parnas`, `.ccp` `.adp` and `.statekey` files. The generator's inventory maps evidence filenames to revisions and source identities and lists insufficient contracts separately. Names in an ordinary source tree do not supply this evidence by themselves.

Copy `advisory/vlmkit.json` for another repository. Set the pinned Git SHA, package directory patterns, per-package source roots and history depth. Optional `cases` link specific contract, implementation and consumer excerpts by revision and line range. Automatic discovery uses TypeScript interfaces, call sites, static import paths and repeated first-parent non-merge changes. Unresolved dynamic imports, undocumented contracts and omitted patch context limit what it can see. The scan covers the declared roots and history window.

The repository's `pnpm run eval:advisories` verifies the recorded hint evaluation offline. The experiment pairs each of the original 13 rules with a defect fixture and includes four repository examples, among them a historical distribution failure and a reviewed false alarm. Each is paired with a generic instruction. Three repeated judgments measure whether the instruction identifies a specific check and an observation that can confirm or dismiss the concern.
