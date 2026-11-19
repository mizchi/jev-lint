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

## Public API review

Choose the evidence unit by what one finding should identify. All four rules use `language: Text`, `subject: block` and no `split`, so each generated file provides one subject for each applicable rule. Request batching leaves these units intact.

| Evidence unit | File | Question and rule |
| --- | --- | --- |
| One exported name | `.apibinding` | Is this name reserved for internal use? `export-has-no-public-role`. Can a caller predict its use and effect? `api-use-is-unclear`. Each question gets an independent verdict. |
| One TS entry or Go package | `.apisurface` | Do the public signatures together offer overlapping choices or expose implementation details? `public-api-surface` scores the set from 0 to 4 and reports at 2.37. |
| One documented caller workflow across named entries | `.apiworkflow` | Would a required step force the reader to discover or correct an import path? `entry-layout-obscures-workflow` compares the guide with the actual exports of the selected entries. |

For binding and surface review, point the collector at source entry points from the library's published exports. Use a directory for a Go package. A public guide supplied with `--api-doc` accompanies the binding evidence.

```sh
jev-lint public-api-inputs api-review src/index.ts --api-doc docs/client-guide.md
jev-lint check api-review --config ./node_modules/jev-lint/advisory/public-api.yml --summary
```

For workflow review, identify each entry by the path a consumer imports. Paths to source files and guides in the layout manifest are relative to that manifest. An exact Markdown heading selects its section, including subheadings. Omitting the heading selects the whole guide; use a focused guide in that case.

```json
{
  "entries": { "canvas": "src/index.ts", "canvas/filters": "src/filters.ts" },
  "workflows": [{ "guide": "docs/client-guide.md", "heading": "Edit a frame" }]
}
```

```sh
jev-lint public-api-inputs layout-review --api-layout layout.json
jev-lint run text/entry-layout-obscures-workflow layout-review --no-config --summary
```

The layout run also produces the binding and surface inventories. Use the same four-rule configuration above to review all three units. Its JSON inventory links each workflow file to the guide and source lines. Export names come from the resolved TS entry (including barrel and type-only exports) or the selected Go package. Include every public entry relevant to the task; omitted subpaths have unknown contents. If the section and map exceed the text budget, the collector reports an error before writing the evidence.

In fenced JavaScript and TypeScript examples the collector checks static named imports against the reviewed TypeScript entries. Each lookup uses the exported name before a local alias and records type-only exports. A missing name lists any reviewed entries that supply it. Names absent from every reviewed entry cannot establish that switching entries would fix the guide. In prose the collector also checks same-line provider references written as `` `name` from `package/path` ``. Other phrasing, namespace imports and dynamic imports go to the model with the entry map.

For fenced Go examples, the collector parses each snippet and checks package-qualified names against the selected packages. An explicit import resolves by path, including aliases. In an excerpt without imports, a qualifier can match a unique declared package name among the reviewed entries, such as `git` for a path ending in `/v6`. The evidence labels that match as inferred. A local receiver such as `r` in `r.Head()`, an ambiguous package name or an unparseable snippet contributes no lookup. Each fence has its own scope. The collector does not compile the examples.

For example, an editing guide might promise `open`, `mapPixels` and `commit` at the root. Moving `commit` to `canvas/filters` leaves its individual contract intact but breaks the documented route. An explicit handoff to `canvas/filters` makes the split usable. The workflow finding asks the reviewer to try the published imports before choosing between a documentation change and a re-export.

The collector returns the public name count, alias count and number of primary bindings with declaration or member documentation. The documentation denominator is `count - aliases`. Supplied guide text is evaluated for meaning and does not increment this count. Use the counts to interpret the sample. The report's `--summary` gives flagged/answered separately for each question and counts unanswered subjects separately. Findings remain advisory.

Pass a guide that applies to the selected entries. An invocation can share one guide across its targets. The optional `--api-doc` text, JSDoc or Go doc, package documentation and up to six related public signatures accompany each binding in `bindings/`. Related signatures are selected by identifier matches within the same entry. A sparse doc count is a prompt to read the contract. For example, the rule fixture `Apply(data []byte) bool` with a tautological comment raises a clarity finding. The same signature passes when the guide explains that it installs a replacement schema and a false return preserves the previous one.

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
