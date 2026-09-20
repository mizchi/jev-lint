# Changelog

Every release, newest first. The numbers — how many rules, how many reach
precision and recall 1.00 on their own fixtures at the shipped cutoff —
are re-derived by `jev-lint eval --replay` from the accepted baselines,
and [RULES.md](RULES.md) is the current list. Measurements behind each
change are in [docs/findings.md](docs/findings.md).

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
