# Checking documentation against itself

`jev-lint docs` compares declared claims, terminology and translations using the
same validated Choice transport used by the relation API. It reports both exact
source excerpts. It does not rewrite documentation or grant approval.

```sh
just docs-facts
source ~/.profile
just docs-check --record .jev-lint/documents-baseline.json
just docs-replay
```

## Scope

`.jev-lint/documents.json` names current documents, canonical references,
historical records and explicit comparison selectors. Heading selectors ignore
headings inside fenced examples. Optional `contains` selects one paragraph; a
missing or ambiguous selector is unassessed, never an empty clean comparison.

The registry includes README.md, README-ja.md, the reference and API guides,
the contributor instructions and current architecture notes. Known historical
experiments remain explicitly classified. Unregistered Markdown under the selected
roots, current documents without a comparison, unavailable sources and budget
exclusions remain visible. This covers declared bindings, not every possible
claim in every paragraph or every semantic connection across the repository.

`docs/project-facts.md` is generated from package metadata, the default model and
the rule catalog/accepted fixtures. `docs-facts --check` catches stale generated
facts without a model. [RULES.md](../RULES.md) remains the generated per-rule
catalog. The [glossary](glossary.md) distinguishes caches, accepted findings,
calibration records, processing completion and quality verdicts.

## Live and replay

A live check reads regular files from the working tree, refuses symlink sources
and records content digests. It does not execute checkout scripts or load parser
libraries. The transport checks snapshot freshness before sending and the runner
checks it again after evaluation. Supply a trusted manifest in a hosted service;
repository text is evidence and cannot approve itself. Credentials stay in the
environment and are not document inputs.

`--dry-run` prints the plan with zero model requests. `--record` writes all
answers, locations, question identity, usage and omissions. The default bounds
are 100 comparisons, 64,000 characters per comparison, 256 kB per source file
and two million characters of loaded source text. Actual requests also have
client-wide request, token, time and cost bounds.

Replay validates recorded answers against the current manifest, source digests,
selected excerpts and question. It makes no model requests. Any changed input
requires refreshing the record; stale evidence cannot certify the new snapshot.
CI checks generated facts and replays the committed documentation record without
an API key. A changed documentation binding therefore needs a new live record.

Exit 1 means a contradiction was found, 3 means incomplete/stale assessment,
and 2 means invalid arguments or manifest. Exit 0 means the declared comparisons
agreed; it does not certify all documentation or quality PASS. Snapshot changes
during a run take precedence over an old contradiction and yield exit 3.
Every report retains `qualityVerdict: "UNREVIEWED"`.

## Defining comparisons

The manifest uses repository-relative regular file paths. Each selector names
one registered source and optionally an exact ATX heading and a unique paragraph
substring. A heading includes its subsections until the next heading at the same
or a higher level. Missing or repeated headings need an explicit selector fix.

```json
{
  "schema": "jev-lint-documents-manifest-1",
  "roots": ["README.md", "docs"],
  "exclude": ["docs/archive"],
  "files": {
    "contract": { "path": "docs/contract.md", "role": "reference" },
    "guide": { "path": "README.md", "role": "document" }
  },
  "comparisons": [{
    "id": "runtime",
    "topic": "Minimum supported Node version",
    "mode": "semantic",
    "reference": { "source": "contract", "heading": "Runtime" },
    "target": { "source": "guide", "heading": "Requirements" }
  }]
}
```

`semantic` compares claims, `translation` compares meaning across languages,
and `terminology` compares definitions and allowed aliases. Optional `context`
selectors add supporting excerpts. Context alone does not bind a document for
coverage. `document` files need a comparison; `reference` files define facts or
terms; `historical` files retain dated evidence without requiring current parity.
All registered file contents still participate in snapshot freshness. Inventory
roots are literal paths; exclusions use the ordinary path/glob exclusion syntax.
Inventory skips hidden entries, symlinks and build/dependency directories.

The library exports `prepareDocuments`, `scanDocuments`, `parseDocumentReport`
and their types from `jev-lint/documents`. Planning and replay work offline;
the scanner accepts the same `AskClient` and request controls as other APIs.
The CLI accepts `--model` and the `JEV_LINT_MODEL` environment override; its
document manifest is independent of the ordinary rule configuration.

## Evaluation

Contradictory current defaults, numeric catalog drift, mismatched translations,
cache/acceptance confusion and completion/PASS confusion are defects. Compatible
paraphrases, explicit exceptions, differing command modes and dated historical
measurements are controls. Missing context must remain distinct from agreement.
The model corpus includes clean counterparts; deterministic tests separately
reject malformed and stale records. This is a development corpus rather than
a production accuracy estimate. No shipped lint cutoff is guessed or changed
for this command.

The frozen corpus has 32 cases, each evaluated three times with `jev-1.14.0`.
Both recorded prompt iterations score 100/100 with no regressions. The rubric
checks the expected semantic choice, strict report integrity and honest coverage
and exit status; all 288 checks pass. See the [evaluation record](../experiments/documents/README.md)
for the inputs, separate labels, recorded answers and replay commands.
