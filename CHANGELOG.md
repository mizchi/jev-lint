# Changelog

Every release, newest first. The numbers — how many rules, how many reach
precision and recall 1.00 on their own fixtures at the shipped cutoff —
are re-derived by `jev-lint eval --replay` from the accepted baselines,
and [RULES.md](RULES.md) is the current list. Measurements behind each
change are in [docs/findings.md](docs/findings.md).

## Unreleased

### Added

- One built-in matcher for a test, `matches: jev-test-call` (and
  `jev-suite-call`), used by the five TypeScript test rules and the
  container probe: jest, vitest, vitest in-source, node:test (the options
  object, `t.test` subtests, a parent with subtests as a suite),
  `@playwright/test` (`test.describe` and its modifiers, `test.fixme`),
  `Deno.test` in its string, object and named-function forms, and
  `bun:test` (`test.if`, `test.skipIf`). A todo with no body and
  `test.step` are not tests. Fixtures for each shape under
  `test-name-verifies-claim`: every defect flagged, every clean passed.
- A test's question carries its whole address: `inside: suite \`cart\` >
  suite \`removeItem\`` for a test two describes deep, on every arm, and
  in the verdict's cache key.
- A module with vitest in-source tests is its own related test on the
  `paired` arm; `tests-cover-failure-paths` has a fixture for it.

### Fixed

- The `paired` arm's test excerpt is chosen by relevance and sized by the
  subjects in the file. It was keyed on the module's stem and cut from
  the middle at a flat 8,000 characters, and in a repository with one
  test file for everything the stem (`config`) matched three hundred
  lines of `--config` flags while the one test of `findConfig`'s throw
  was in the cut; sixteen functions of this repository read as untested,
  and after the fix six, each of them really so. Keywords are in priority
  order -- the subjects' own names, the module's exports, the stem last
  -- and the budget grows by 2,000 characters per subject to 32,000. The
  excerpt is in the verdict key on that arm, so a better excerpt is a
  new question and not a cache hit. Among the related test files, a name
  match outranks an import (every test file may import a module for a
  fixture builder, and alphabetically the four that did once shut out
  `rules.test.ts`), the four that name the most of what is asked about
  are chosen, and the budget is split among them by that relevance.
- A text rule's root outside the working directory (`check ../queries`)
  found nothing: the walk names such a file absolutely and the root was
  compared as given.
- `commits --base <ref>` with `paths:` in the config judged every commit
  touching the first path -- the config's path had become the git range.
  Found by running the tool on its own history: 52 commits "in src" for
  four since the last release. The range is a positional or `--base`, and
  a config path is never one.
- A verdict was keyed on the subject's text and its context, not on what
  the matcher captured, so a comment rewritten above an unchanged
  declaration kept the old verdict through every run -- for a comment rule
  the comment is the claim. Captures are in the key; the cache schema is
  `jev-lint-cache-4`, and a cache from 0.4.x is dropped loudly and rebuilt
  by one warm run.

### Added (from running the tool on itself)

- `--dry-run` prices the plan per rule: subjects, requests, tokens, dollars
  and share, dearest first, with each batch's state charged to its rules
  by the subjects they put there (`src/cost.ts`).
- `exclude:` in the config and `--exclude <path>`: a path under the roots
  whose files are never judged. This repository's suite was one 4,300-line
  file, named in the config so that `test/fixtures` stayed out; split into
  `test/<module>.test.ts`, the config names `test` and carves the fixtures
  out of it.
- `--summary`: the findings counted by rule, and by file with the
  subjects judged there, densest first; `stats.byRule` / `stats.byFile`
  in `--format json`.

### Changed

- `src/cli.ts` (1,418 lines, `main` alone 278) is `src/cli/`: one module
  per step -- `args`, `context`, `select`, `targets`, `check`, `dry-run`
  -- and one per command, with `main.ts` only the order they happen in.
  The two places a positional and a config path had been the same
  variable are two named values. `dist/cli.js` is still the bin.
- What the tool said about its own code, acted on: one `tryReadFile` /
  `tryReadDir` where five modules each swallowed a read error in their
  own words; `computeCalls` that assigned is `linkCalls`, `toRecord` that
  read the clock is `buildRecord`, `parseArgs` no longer reads the
  `--message-file` or the terminal; a `FileIndex.list(roots)` that
  returned more than the roots is `extend`; three comments that had
  drifted from their code; tests for the failure paths of `runAstGrep`,
  `defaultRange`, `loadSuite`, `planEval` and `collectRows`. 42 findings
  on the tree, then 13, the rest within 0.05 of a cutoff or arguable.
- The node kind of a test subject is `test` (a suite's, `test suite`),
  not `composite match`. The six rules' baselines were re-accepted:
  precision and recall 1.00 on each.

## 0.4.1 — 2026-09-20

### Added

- `rules/markdown/`: eleven rules over a Markdown file. Eight
  writing-quality rubrics ported from [JevSlop](https://github.com/TKY-27/JevSlop)
  (`document-is-slop`, `-filler`, `-vague`, `-generic`, `-formulaic`,
  `-padded`, `-lacks-firsthand-evidence`, `-incoherent`), each a five-level
  `score` over the file as a whole, with JevSlop's "higher is better" axes
  reversed so a high score always means the defect; and three checks from
  [k16shikano's cognitive-rhythm writing norm](https://gist.github.com/k16shikano/eb2929f13ed19c97188393d297be8432)
  for Japanese explanatory prose (`section-ends-with-a-preview`,
  `section-opens-with-an-agenda`, `document-abandons-a-question`): does a
  sentence update the subject, or only the document. Three more from the
  same two sources are candidates with the reason they are not shipped.
- `levels:` on a `score` rule: an ordered rubric of the rule's own, clean
  to worst, in place of the shared four-level scale; `at` runs
  `0..levels-1` and a finding's level is numbered.
- `subject: block` without `split` takes the whole file as one block, cut
  at 48,000 characters at a line boundary; the question and the finding
  both say when a block was cut.
- `/jev-lint:prose`, a plugin command that runs both writing families and
  the norm's leakage test (a grep, not a model question).

### Changed

- A block of a text file is called text, not code, in the question and
  the state. The one existing block rule was re-accepted at the same
  cutoff.
- Two JevSlop rubrics that named amounts ("Central to the article … None",
  "Coherent.") separated in the wrong direction or not at all; each level
  is reworded as a statement about the document, and the rule files say so.

## 0.4.0 — 2026-09-20

### Breaking

- The verdict cache has a schema of its own (`jev-lint-cache-3`), separate
  from the rule draft's. A cache written by 0.3.x loads as "written for
  schema jev-lint-2 … its N verdict(s) … are dropped" and is rebuilt by one
  warm run, instead of missing on every entry in silence.
- The npm package ships the rules and not their fixtures: `rules/**/rule.yml`,
  `rules/README.md` and `RULES.md` — 147 files and 280 kB against 499 and
  2.5 MB. `jev-lint eval` is for a checkout of this repository or a
  project's own rule directories, and says so.

### Added

- Every spelling of the config file is recognised: `.jev-lint.yaml`,
  `jev-lint.yaml`, `.jevlint.yml` and the rest of the eight. Two in one
  directory stop the run with exit 2 rather than one being picked in
  silence.
- A suppression naming a pre-0.3 language-suffixed id
  (`jev-lint-ignore fn-name-promises-rust`) is told the new name.
- An "Upgrading from 0.2" section in `docs/reference.md`.

### Changed

- One walk of the tree serves the `paired` arm and the block rules; each
  root is walked once per run.

## 0.3.2 — 2026-09-20

### Added

- `describe-names-subject` (typescript): does a `describe("X")` title name
  what the tests inside exercise. 54 rules.
- `RULES.md`, generated from `rules/` by `tools/rules-md.ts`
  (`npm run rules:md`) and checked by the test suite: every rule's
  configuration, fixtures, and precision and recall at the shipped cutoff.
- `/jev-lint:commits`, a plugin command.

### Fixed

- A baseline is re-keyed to where its suite lives, on what follows
  `fixtures/`. Writing RULES.md found nine Go and three Python rules
  scoring at precision 0.00 against their own labels after promotion from
  `experiments/`, while `eval --replay` said "all as shipped" — it compares
  decisions with the ones accepted, not with the labels.
- `run <id>` scans the config's `paths:`, like `check`, not the whole tree.

## 0.3.1 — 2026-09-20

### Fixed

- A verdict was keyed on the subject's text alone, so two identical nodes
  in different functions — a `logger.info("cache hit")` pasted into the
  miss branch — shared one question and one answer at every arm. The key
  carries what the arm shows: the enclosing code on `local`, the file and
  container on the file-bearing arms, the match's offset inside its
  container for a promoted subject. Found by two candidate rules at once.
- `git diff` with `diff.external` set (difftastic, delta) returned a
  rendering the model was never calibrated on; every diff-producing call
  passes `--no-ext-diff`.
- `gaps` honours `--dry-run` and `--record`.

### Added

- Eight rules: `type-name-describes-shape`, `error-message-matches-condition`,
  `catch-hides-failure`, `log-message-matches-event` (typescript);
  `doc-errors-match-body` in typescript, python and rust — the doc's
  failure contract (`@throws`, `Raises:`, `# Errors` / `# Panics`) against
  the body; and `query-name-describes-sql` (text), the first
  `subject: block` rule, over an sqlc catalog split at each `-- name:`.
  53 rules, 391 labelled defects, 46 at precision and recall 1.00.
- `commits --squash <range> --message-file <path|->`: a whole range as one
  change, judged against a pull request's description or a changelog
  entry.
- `subject: block`: a text file no grammar parses, split at every line
  matching a rule's `split:` regex, the header's named groups being the
  captures; `language: Text`, `extensions:`.

## 0.3.0 — 2026-09-20

### Breaking

- Rules live at `rules/<lang>/<id>/` with `fixtures/`, `expect.yml` and
  `baseline.json` beside each. The `-rust` and `-js` suffixes are gone:
  `fn-name-promises-rust` is `rust/fn-name-promises`, `--at <id>=n` names
  every language that has the id and `--at rust/<id>=n` one. `labels.json`
  is `expect.yml`. A project's own flat `rules/*.yml` loads as before.
- A language directory admits only its own grammars (`typescript` admits
  the ECMAScript four); the same id under two directories is one rule in
  two languages, and the loader warns when the copies of its sentence
  drift.

### Added

- 45 rules across `typescript` (15, first tier), `rust` (7, first tier),
  `python` (11) and `go` (9, including `must-name-panics`), `javascript`,
  `json` and `git`. 343 labelled defects, 38 at precision and recall 1.00.
- `jev-lint commits [range]` and `git/commit-message-describes-diff`: does
  a commit's message describe its diff. `init --pre-push`.
- `jev-lint run <rule> [paths...]`: one shipped rule by id, or
  `--file <rules.yml>`.
- `state: paired`: the matched code, its enclosing function and excerpts of
  the file's related tests — the one arm whose evidence is in another file
  — and `tests-cover-failure-paths` on it.
- `--loose [n]`: the band under each cutoff, listed for a reader and never
  a finding; `loose:` on a rule.
- `--explain` with a rule's `explain:` labels: one `choice` per reported
  finding, naming why.
- A noul criterion may be a `{what, examples, not_for}` mapping (measured
  neutral against a sentence).
- `eval --dry-run` plans and prices instead of silently asking; one idle
  line per language a run saw no file of.

## 0.2.1 — 2026-09-20

- Every rule in its own directory with its own evals, and `jev-lint eval`
  (`--replay`, `--accept`, `--compare`) as the gate; the labels out of the
  corpus files.
- The rule-improvement round: 113 → 200 labelled defects, 20 of 23 rules
  at precision and recall 1.00 at the shipped cutoffs.
- A test callback as a container; a captured comment widened to its run;
  the module outline capped and nested.
- `--fail-on`, `--staged`, `init --pre-commit`; the Claude Code plugin and
  `npx skills` install paths.

## 0.2.0 — 2026-09-20

- `pure-name-is-pure` shipped at `info` after a second revision;
  `assertion-message-matches` kept as a recipe. 23 rules, 22 at precision
  and recall 1.00 on 988 subjects.

## 0.1.0 — 2026-09-19

- First release: a linter over ast-grep and Jev — a matcher picks the code,
  one sentence is the rule, a model answers it. The naming and comment
  packs, the calibrated corpus, record/replay, the state arms, batching
  across a rule set.
