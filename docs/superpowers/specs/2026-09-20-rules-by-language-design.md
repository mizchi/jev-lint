# Rules by language

2026-09-20. Approved in conversation; this is the record.

## Why

`rules/<id>/rule.yml` holds every grammar's variant of one rule as a YAML
multi-document with anchors, and `rules/<id>/evals/cases/` mixes `.ts`,
`.js` and `.rs`. Reading one rule means reading three matchers; adding a
language means editing every family's file; a label file carries a `rule:`
key per entry to say which variant it belongs to. The implementations are
mixed, and the layout should separate them.

## Layout

```
rules/
  typescript/<id>/rule.yml        one document, one rule
                  fixtures/*.ts   the cases (was evals/cases/)
                  expect.yml      the expectations (was evals/labels.json)
                  baseline.json   the accepted eval record
                  last.json       the previous eval record, gitignored
  rust/<id>/...
  javascript/<id>/...             only where a JavaScript-specific matcher exists
  python/<id>/...                 phase 2
  go/<id>/...                     phase 2
```

- A language directory's name resolves through `normalizeLanguage`.
  `typescript` admits the four ECMAScript grammars (TypeScript, Tsx,
  JavaScript, Jsx); every other directory admits its own grammar only. A
  rule whose `languages:` names a grammar outside its directory is a load
  error. This is what keeps implementations unmixed.
- `rule.yml` is one document and one rule. The loader still accepts the
  sequence and multi-document forms for rule files outside this layout, so
  a project's own `rules/mine.yml` keeps working unchanged.
- The convention applies only to a path matching `<lang>/<id>/rule.yml`
  under a rules root. Any other rule file has no language directory, no
  fixture set and no tier, as today.

## Identity

The identity of a rule is `(language, id)`. `fn-name-promises-rust`
becomes `rust/fn-name-promises`; the `-rust` and `-js` suffixes go.

- Findings, `jev-lint-ignore` comments and `--at id=n` name the `id` and
  apply to every language that has it. A file is one grammar, so an ignore
  is never ambiguous. `--at rust/fn-name-promises=0.6` names one language.
  `cutoffFor` looks up `lang/id` before `id`.
- The cache key already hashes the matcher, so two languages' verdicts
  never collide. Nothing in the cache changes shape.
- `Rule` gains `language_dir: string | null` (the directory, when the rule
  was loaded from the layout) and the loader's duplicate check is on
  `(language_dir, id)`.
- **Drift warning.** The sentence is now a copy per language. `jev-lint
  rules` warns when one `id` appears under two language directories with a
  different `ask`, `criteria`, `note` or `explain`. A warning, not an
  error: a language may legitimately need a different clause, and the
  warning is the place to say so in a comment.

## expect.yml

```yaml
default: clean          # was $default
note: optional          # was $note
fixtures/cart.ts:       # relative to the rule directory
  - { line: 24, label: bad, reason: "`get` promises a read; this deletes." }
  - { line: 51, label: clean, reason: "hard clean: terse but accurate", window: 0 }
```

Same fields as a label today minus `rule:`, which the directory decides.
`window` keeps its meaning. Markers never go inside a fixture: the comment
rules read comments.

## Tiers

`TIER_ONE = ["typescript", "rust"]`. A rule under a tier-one directory must
have `fixtures/`, `expect.yml` and `baseline.json`; `npm test` checks that
for the shipped rules and `jev-lint eval` runs every suite. A rule under
any other directory loads without them and `jev-lint rules` prints
`uncalibrated` beside it. The README lists the tiers. No family is
required to exist in both tier-one languages.

## Evals

`discoverEvals` looks for `expect.yml` beside a `rule.yml`; a suite is
named `lang/id`. `eval [dir]` accepts a rules root, a language directory
or one rule directory. Records keep their shape; `suite` carries the new
name and paths are relative to the rule directory (`fixtures/x.ts`).

## Migration (phase 1)

One script, run once, not kept. No request is sent.

1. Split every `rules/<id>/rule.yml` document into its language directory,
   dropping the `-rust`/`-js` suffix from `id`, keeping the file's header
   comment with the first document and each document's own comments with
   it. Resolve anchors into text; each copy is then independent.
2. Move `evals/cases/*` by extension: `.ts .tsx .js .jsx` → `typescript`,
   `.rs` → `rust`; `comment-describes-declaration`'s `legacy_cart.js` →
   `javascript`.
3. Write `expect.yml` per language from `labels.json`, keeping each file's
   entries whose `rule:` is that language's variant (or has no `rule:`),
   dropping the key.
4. Split `baseline.json` by rule id into one record per language, rename
   the rule ids, rewrite paths, set `suite`. `jev-lint eval --replay` over
   `rules/` then reports every suite "as shipped" — 24 suites, all green,
   is the migration's acceptance test.
5. `experiments/rule-candidates/<id>` → `experiments/rule-candidates/typescript/<id>`
   with the same rewrite; `BRIEF.md` and `IMPROVE.md` follow.
6. `package.json` `files`: `!rules/**/last.json`. `.gitignore` likewise.
7. Docs: README (layout, tiers, rule table), `docs/reference.md` (Layout,
   Rule fields, The shipped packs), `skills/jev-lint/SKILL.md`,
   `references/{rule-fields,using-shipped-rules,calibration,cookbook}.md`,
   `rules/README.md`, `commands/new-rule.md`.

## Phase 2: Python and Go

After phase 1 lands, port the families whose claim transfers, one
subagent per language following `experiments/BRIEF.md`, into
`rules/python/` and `rules/go/`. They are calibrated to the same bar but
stay tier two until the README says otherwise.

Transfers: `fn-name-promises`, `var-name-describes-value`,
`comment-describes-declaration`, `comment-describes-block`,
`test-name-describes-code`, `test-name-verifies-claim`,
`module-name-describes-contents`, `idempotent-name`, `pure-name-is-pure`,
`safe-name-is-safe` (Go: `*OrZero`, `Try*`, `Must*` inverted; Python:
`*_or_none`, `safe_*`), `log-level-matches-event`,
`tests-cover-failure-paths` (needs `paired` to recognise `test_*.py` and
`*_test.go`; the `_test.go` form already pairs, the `test_` prefix does not
and is added).

Does not transfer: `test-mocks-subject` (vi.mock), `snapshot-only-behaviour-claim`
(Jest snapshots), `script-name-does` (package.json), `module-naming-consistent`
(revisit once the outline renders Go receivers and Python classes).

Node kinds, for the matchers: Python `function_definition`,
`decorated_definition`, `assignment`, `comment`, `module`; Go
`function_declaration`, `method_declaration`, `short_var_declaration`,
`var_declaration`, `comment`, `source_file`. `jev-lint check --dry-run
--show-subjects` over the fixtures confirms each matcher before anything
is asked.

## Phase 3: commits

A commit message is a claim and its diff is the body, which is the class
this tool exists for: "Fix the retry loop" over a diff that adds a
feature; "Refactor, no behaviour change" over a diff that changes a
default. Added on request, in the new layout, as `rules/git/`.

- **Subject.** A commit is not an AST node, so `subject: commit` is a new
  subject mode with no ast-grep matcher: `rule:` is absent, `languages` is
  `[Git]`, a pseudo-grammar the loader admits only under `git/` and only
  with `subject: commit`. Nothing else about a rule changes: `kind`,
  `criteria`, `note`, `at`, `loose`, `explain` all apply.
- **Command.** `jev-lint commits [--base <ref> | <range>]` (default
  `@{upstream}..HEAD`, else `--base main`) builds one subject per commit:
  the message is the subject text and travels in the question; the state
  is `{reviewing: "one commit", message, files, diff}`. The diff is
  `git show --format= --no-color <sha>` capped to the state budget; over
  it, the state keeps `--stat` and the first hunks and says what it cut.
  Merge commits are skipped and counted. Findings report `<sha>:1`, and
  every format prints the sha and the subject line. `--retry`, `--loose`,
  `--explain` and the cache (keyed on message + diff) work unchanged.
- **Rule.** `git/commit-message-describes-diff`, a noul: the message
  claims something the diff does not do, or the diff does something
  material the message does not mention. Criteria in terms of what the
  diff shows; the note says a subject line is a summary and a body may
  say "also"; a `Co-Authored-By` trailer or a version bump is not a claim.
- **Fixtures.** `fixtures/*.patch`, `git format-patch` output: message
  and diff in one file, reproducible with `git am`. `expect.yml` keys the
  patch file at line 1. The corpus is built and calibrated to the same
  bar as any rule; hard cleans are the terse-but-true subject line, the
  "also" body, the mechanical rename.
- **Hook.** `jev-lint init` offers a `pre-push` line running `commits`
  on `@{upstream}..HEAD` with `--fail-on error` off, so it prints and
  never blocks until a project earns it.

## Out of scope

Changing what a rule asks, any cutoff, or the cache format. Language
directories for rule files outside the shipped layout.
