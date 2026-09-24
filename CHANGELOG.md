# Changelog

Every release, newest first. The numbers — how many rules, how many reach
precision and recall 1.00 on their own fixtures at the shipped cutoff —
are re-derived by `jev-lint eval --replay` from the accepted baselines,
and [RULES.md](RULES.md) is the current list. Measurements behind each
change are in [docs/internal/findings.md](docs/internal/findings.md).

## 0.7.0 — 2026-09-24

### Added

- **AGENTS.md quality checks.** `markdown/agent-instruction-is-unclear` and
  `markdown/agent-instructions-conflict` judge each heading section against
  the full document. Text rules can use `filenames: [AGENTS.md]` to select
  exact basenames without judging every Markdown file. The two new suites
  have 12 and 14 labelled sections respectively, with no wrong decisions
  across three accepted passes at their shipped cutoffs.
- **Vibe language support.** The shipped pack adds calibrated
  `fn-name-promises` and `test-name-verifies-claim` rules for `.vibe` files.
- **A repository review TUI prototype.** It colors findings and near-cutoff
  answers, shows source at pinned revisions, and exports explicit human
  labels. Recorded full reviews of `mizchi/converge` and
  `mizchi/converge_audit` live under `experiments/dogfood/`; the TUI is a
  repository tool, not part of the npm package.
- **Skill link checks.** `skills/jev-lint` remains the single source for the
  user-facing skill; `skills:check` verifies its `.claude/skills` symlink in
  CI, and `skills:sync` repairs a missing or stale link. The separate
  maintainer skill stays under `.claude/skills/jev-lint-repo`.

### Changed

- **`threshold` is the preferred cutoff name.** Rule files and the CLI use
  `threshold:` and `--threshold`; `at:` and `--at` still work but warn.
  Shipped rules and active documentation now use the preferred spelling.
- **AGENTS.md takes precedence over CLAUDE.md.** A change is judged against
  the `AGENTS.md` in its own tree or index; `CLAUDE.md` is used only when
  that document is absent or unusable. Both are no longer combined.
- **Pre-commit rules can be selected separately.** `hooks.precommit.extends`
  chooses whether staged review inherits top-level rules, and
  `hooks.precommit.rules` adds or overrides the hook's selection. The
  repository now carries its own review hook. The Claude skill separates
  using shipped rules from writing rules in a target repository.

### Fixed

- **MoonBit benchmark titles are outside correctness review.**
  `test-name-verifies-claim` excludes `bench:` tests, which time an operation
  rather than assert its behaviour. Same-package test pairing also uses
  call evidence so failure-path checks can see related MoonBit tests. The
  before and after measurements are retained in `experiments/dogfood/`.

## 0.6.7 — 2026-09-24

### Added

- **A MoonBit whitebox test is a test.** A `*_wbtest.mbt` file is found as
  related evidence for the `paired` arm, like `*_test.mbt`.

### Changed

- **`typescript/test-name-verifies-claim` reads three more assertions.** On
  an unseen front-end suite it flagged tests that were right: a screenshot
  comparison under a name about what is on screen, a `getByRole(…, { name })`
  query under a name about an accessible name, and a not-throw assertion under
  a name claiming only that something does not throw. A paragraph in its
  note now says what each establishes, and `fixtures/panel.test.ts` and
  `fixtures/sparkline.test.ts` add six defects and seven cleans of those
  shapes. Five passes: 43 defects and 50 cleans, precision and recall 1, at
  the unchanged cutoff 0.66. The paragraph is the TypeScript copy's alone and
  says so in `divergent:`.

### Fixed

- **Replay and calibration keep each answer's language.** A recorded answer
  now carries its `<lang>/<id>` key, and retries, gaps, stability and fitted
  cutoffs are computed per language rule, so the Rust and TypeScript copies
  of one id no longer pool their answers. An older record holding one bare
  id in several languages cannot be told apart and is refused, with a
  message to record the run again.

## 0.6.6 — 2026-09-24

### Added

- **`JEV_LINT_CACHE` names the verdict cache.** It sits between the flags
  and the config: a backend can point a run at its own cache without
  editing the project's committed `.jev-lint.yaml`, and an explicit
  `--cache` / `-c` still wins.
- **A colocated `*.vitest.ts` file is a test.** It is found as related
  evidence for the `paired` arm like `*.test.ts` and `*.spec.ts`.

### Changed

- **Rule keys are language-qualified.** `init` writes every shipped rule as
  `<lang>/<id>`, enabled. A bare id in `rules:` still selects the rule in
  every language that has it, but now warns and names the qualified keys,
  since it can quietly turn on another language's copy. An ast-grep match is
  mapped back to the exact language rule that produced it.

### Fixed

- **`exclude:` takes globs.** An entry was always a path prefix, so
  `exclude: ['**/*.snapshot.test.ts']` matched nothing, excluded nothing, and
  the run did not say so. An entry with glob characters is now a glob,
  matched against the file and every directory above it (`**/fixtures`
  leaves out every directory of that name); a plain path works as before.
- **The Claude Code plugin manifests carry the package's version.** Both
  stayed at 0.4.1 from 0.4.2 through 0.6.5, so an installed plugin was never
  offered the updated skill. A test now holds them to `package.json`.

## 0.6.5 — 2026-09-23

This section also carries what 0.6.2 through 0.6.4 published without a
section of their own.

### Added

- **`extends`: a project's rule built from a shipped one.** Adapting a
  shipped rule to a project's conventions meant copying its file under a new
  id, and from then on the copy got none of the upstream fixes to its
  matcher, criteria or cutoff. A rule file may now name a base --
  `extends: typescript/test-name-verifies-claim`, or a bare id when its
  `languages` pick one language -- and give only the fields that differ.
  `criteria` may give one branch alone, and `note: { append: ... }` adds to
  the base's note instead of replacing it, since on a shipped rule the note
  is usually measured wording. The base is found among the rules loaded
  beside it, then in the shipped packs, which are read for the lookup and
  not run because of it. The extending rule needs its own id; a missing, an
  ambiguous and a circular base are load errors. A rule that changes what is
  asked but keeps the base's `at` is warned about: that cutoff was fitted to
  another question.

- **`context`: documents the model reads beside the code.** A project's
  conventions -- that a screenshot comparison is the assertion of a visual
  test, what a helper in another file sets up -- are not in the code under
  review, and a `note` copied into each rule drifts from the document it was
  copied from. `context: [path, ...]`, relative to the rule file, is read at
  load time and sent in the state as `context_documents` on every arm. The
  text is part of the draft hash, so editing the document retires the
  verdicts given against the old one. Up to 40,000 characters in all, about
  a third of the state budget, refused rather than cut; a missing or empty
  document is a load error. Rules with different documents are never
  batched into one state. `jev-lint rules` lists both fields.

- **A diff judged against the `AGENTS.md` the repository wrote for itself.**
  `AGENTS.md` and `CLAUDE.md` say what a change is supposed to do and nothing
  checked them: a diff that adds the dependency the file forbids, edits the
  file it calls generated, or ships without the test it requires passes every
  linter in the repository, because the claim it breaks is a sentence in a
  markdown file.

  `git/diff-follows-instructions` is that rule, and `subject: change` is the
  new subject it needs — a commit rule's subject is the *message*, and at
  pre-commit time there is not one. A change subject's state carries the
  diff and the documents as they were in that change's own tree, so a commit
  is judged by the instructions that were in force when it was made, and a
  staged edit to `AGENTS.md` travels with the code it governs. A tree holding
  neither document produces no subject at all, and the run says how many
  commits that was rather than reporting a rule with no matcher as a matcher
  that missed.

  Fitted at `at: 0.65`, P 1.00 R 1.00 over eight fixtures, no flips across
  three passes. The fixtures could not choose the number — their gap is 0.50
  to 0.93 and any cutoff inside it scores the same — so it came from this
  package's own last twelve commits, where 0.70 was missing two real breaches
  of this repository's own `AGENTS.md`. The residue is in the rule's `at:`
  comment.

  The half that makes it usable is `criteria.false`. An `AGENTS.md` is mostly
  instructions a diff cannot be held against — develop test-first, ask when
  unclear, read the skill first — and judging those puts every answer
  mid-scale where no cutoff separates. Named as false, they stand aside. The
  fixture that is nothing but such instructions answers 0.50 rather than
  0.05, and that is the number to watch if the sentence is ever reworded.

- **A finding names the instruction it is about, or is not printed.** After
  the verdict, a second pass splits the documents into directives — headings
  become breadcrumbs, a list item folds its children in, mechanically, so
  that a cutoff fitted against one list still holds against the next — and
  asks one question per directive against the state the verdict already used.
  One extra request per flagged change; a clean change pays nothing. A
  finding no directive accounts for is **retracted** to the `--loose` band
  rather than reported: the first pass is a cheap gate, and a violation
  nobody can point at is not one worth turning an exit code over.

- **`jev-lint commits --staged`** — the index as one change, which is what a
  pre-commit hook asks.

- **`jev-lint eval` fails a suite whose fixtures cannot measure its own rule.**
  A rule's corpus exists to catch the rule drifting, and `P 1.00 R 1.00` says
  nothing about whether it can. Two distances now decide, each normalised by
  the rule's scale: from the cutoff to the quietest labelled defect, and from
  the cutoff to the loudest labelled clean.

  Both wider than a quarter of the scale and the corpus is **blind** — every
  fixture sits so far from the boundary that the rule could move a quarter of
  the way across it and no number would change. Either one narrower than that
  same case's own pass-to-pass spread and the corpus is **unstable** — which
  side of the cutoff that case lands on is decided by the run, not by the
  rule. Fifteen shipped suites were blind when the first half went in, and
  `typescript/pure-name-is-pure` was reporting `R 1.00` while its quietest
  defect cleared the cutoff by 0.00 against a spread of 0.01.

  A suite that is one of these for a reason declares `inconclusive:` in its
  `rule.yml` saying which. The declaration is printed under the rule's row on
  every run the suite is reported, not only the run it breaks on, and a
  declaration on a suite that is neither blind nor unstable is an error, so an
  exemption cannot outlive the thing it excuses.

### Changed

- **`init --pre-commit` and `--pre-push` write the hook into the repository**,
  at `.jev-lint/hooks/<name>`, and leave a shim in git's hooks directory that
  finds and runs it. A hook nobody can see is a hook nobody reviews. A missing
  body exits 0 silently, so a clone that has the shim before it has the body
  can still commit, and `init` on a fresh clone installs the shim without
  refusing because the body is already there.

- **A failed request no longer blocks a commit or a push.** `review --staged`
  exits 3 when its requests fail — deliberately, since the run has no verdict
  — and git fails a hook on any non-zero exit, so being offline or holding an
  expired key stopped you committing. The shipped bodies let 3 through and
  nothing else.

- **The corpora were aimed at the cutoffs, and the scores went down.** 644
  labelled defects became 707, and 87 of 98 rules at precision and recall 1.00
  became 79 of 99. That is the point rather than a regression: the new cases
  sit next to each rule's decision boundary instead of a comfortable distance
  from it, so a rule that scored 1.00 on cases it was never going to miss now
  reports what it does where it actually has to decide. Every cutoff that
  moved carries the run it moved on in its `at:` comment.

  Four things the boundary found, each kept as a labelled case rather than
  quietly dropped:

  - `shell/runs-downloaded-code` cannot see **who controls a checksum**. A
    binary and the `.sha256` it is graded against, both downloaded from the
    same host, answers 0.13 — inside the clean band, beside genuine
    verification at 0.08 and 0.10. `sha256sum -c` reads as a check to the
    model whatever its provenance, and today's wording has no clause for it.
    Accepted as a miss (`R 0.86`) rather than bought with a false positive on
    real code.
  - `text/query-name-describes-sql` reads `WHERE status = 'pending'` under the
    name `CountActiveOrders` as a **false positive** at 0.83–0.84,
    confidently, where `deleted_at IS NULL` under `Active` passes.
  - `rust/module-name-describes-contents` cannot tell **one stray export from
    one more facet** of a cohesive module: a defect at 0.17 interleaves with a
    genuine clean at 0.18.
  - `shell/installs-persistence` and `moonbit/var-name-describes-value` each
    hold an **inverted pair** — a labelled defect below a labelled clean — so
    no cutoff gets both right. Both keep precision and take the miss, because
    a linter that flags correct code on sight is the worse trade.

  Two rules turned out to have been cut too high rather than merely
  untested. `markdown/document-is-slop` and `markdown/document-is-vague`
  took their cutoffs (2.0 and 2.2) from their rubric's own semantic
  boundary, with no case anywhere near it to check that against. Six
  documents written for the middle of each scale found three real misses —
  a half-grounded listicle at 1.69, and a document alternating mechanism
  with vague benefit at 1.62 in English and 1.83 in Japanese — putting
  recall at 0.90 and 0.78 where both had reported 1.00. Refitted to 1.1 and
  1.4.

- **A cutoff is fitted on each case's observed range, not on its mean.**
  `separable` used to mean *the means do not overlap*, which is weaker than
  every reader takes it for: two cases whose means differ by 0.01 and which
  each wobble by 0.10 got a midpoint between them and a clean bill. It now
  means the ranges do not overlap, and the case where the means separate but
  the ranges do not says so in its own words rather than reporting a fit.
  Ten shipped cutoffs moved by between 0.01 and 0.11 as a result; none of
  them changed a decision on its own fixtures.

### Fixed

- **An HTML 403 no longer stops the run.** A web application firewall in
  front of the API refuses some requests by their content with its own HTML
  page and a 403. Every 403 was taken as an account error, which stops the
  run on the first one, so one refused file left most of a run without a
  verdict. A 403 whose body is markup is now a failure of that batch alone,
  and its message says it did not come from the API.

- **A commit subject and a change subject over the same commit shared one
  batch, and one of them lost its state.** Both are `arm: "bare"` with the
  sha as the file, which was the whole grouping key, so the change rule's
  question went out against a state carrying a commit message and no
  instructions. Nothing failed — a model handed no standard answers anyway.

- `jev-lint run <a change rule> main..HEAD` took the range as a directory and
  planned nothing, silently, because the router counted only
  `subject: commit`.

- An off-duty git rule was counted in `N rule(s) matched nothing`, which is
  the one place a matcher that matches nothing is visible.

- An empty commit produced a change subject with an empty diff, costing a
  request to ask whether nothing breaks the instructions.


## 0.6.1 — 2026-09-21

### Fixed

- **A missing parser was invisible in `--dry-run`, and the report said the
  opposite of the truth.** Found by installing 0.6.0 from the registry and
  running it over a directory with one `.mbt` file in it: the plan said `no
  files for moonbit (20)` — the file was right there — and said nothing
  about a parser, because the notice was only ever printed by a real run's
  report. A language whose parser nobody declared produces no subjects,
  which is what the idle line counts, so the two lines contradicted each
  other. `--dry-run` now carries the notice, and neither output calls an
  undeclared language fileless.

## 0.6.0 — 2026-09-21

65 rules to 98: `shell` is a new language directory, `moonbit` is a new
language directory, and the naming pack grew a class-level pair. Nothing
about the config or the CLI changed, and nothing starts running by itself
— a 0.5 config lists the rules it wants and keeps running exactly those,
so the 33 new ones are off until they are listed. `jev-lint rules` names
them all and `jev-lint init --force` rewrites the list with every shipped
id on.

### Added

- **`rules/shell/`: eight rules that read shell scripts**, a port of
  [luantak/is-malicious](https://github.com/luantak/is-malicious) onto
  `sh`, `bash` and `zsh` (one ast-grep grammar, `Bash`, parses all three).
  `runs-downloaded-code` (0.40), `hides-what-it-runs` (0.30),
  `installs-persistence` (0.50), `opens-a-backdoor` (0.50),
  `takes-remote-commands` (0.50), `reads-secrets-it-does-not-own` (0.62),
  `destroys-beyond-its-scope` (0.66), `weakens-security` (0.66). All eight
  reach precision and recall 1.00 on their own fixtures with no decision
  flips over three passes; 159 labelled subjects, 56 of them defects.
  These are the one pack not about a claim the code makes: a script is the
  artefact that gets executed without being read, and each of its dangerous
  constructs has a legitimate twin one line away.
  `experiments/reports/shell-malice/` has the measurements, including the
  subject shape that did NOT work.
- `divergent:`, a new rule field: why this language's copy of an id says
  something else. The loader's drift warning asked for a comment and could
  not read one, so the three MoonBit rules whose sentences cannot be the
  shared copy -- `safe-name-is-safe`, `pure-name-is-pure`,
  `idempotent-name` -- warned on every run. They now declare the reason,
  and a `divergent:` on a copy that says the same thing as its siblings is
  a warning in its own right.
- `method-name-promises`, a new rule in TypeScript (0.50) and Python
  (0.47): does a method's body do what its name promises ON ITS CLASS?
  Both halves reach the model by name (`$CLASS.$NAME`), so
  `CartRepository.validate` storing the row it was asked to check is a
  finding that `fn-name-promises` alone has no reason to make.
- `class-shape-shows-its-role`, a new rule in TypeScript and Python
  (0.38): do a class's name, its fields and its method signatures add up
  to one role a reader could name? A `PriceCache` holding a person, a
  `ReportBuilder` that also sends mail, a parser carrying an `smtpPort` it
  never uses. 8 subjects each, precision and recall 1.00;
  `experiments/reports/class-level-naming/` has the measurement.
- `trait-name-describes-methods`, a new rule in Rust (0.62) and MoonBit
  (0.60): does a trait's name describe what its methods do -- the
  capability an implementer gains, which the compiler never checks. 10 and
  11 subjects, precision and recall 1.00, 0.18 and 0.14 of headroom;
  `experiments/reports/trait-name-describes-methods/` has the measurement.
  MoonBit's `type-name-describes-shape` no longer matches a trait, since
  asking both of one declaration reported the same name twice.
- `rules/moonbit/`: twenty rules in MoonBit, nineteen of them ports, every one this tool
  has that a MoonBit file can carry -- `fn-name-promises` (0.44),
  `var-name-describes-value` (0.50), `type-name-describes-shape` (0.28),
  `module-name-describes-contents` (0.55), `idempotent-name` (0.49),
  `pure-name-is-pure` (0.55), `catch-hides-failure` (0.55),
  `error-message-matches-condition` (0.76), `test-name-describes-code`
  (0.70), `tests-cover-failure-paths` (0.68),
  `safe-name-is-safe` (0.39), `comment-describes-declaration` (0.59),
  `comment-describes-block` (0.45), `doc-errors-match-body` (0.50) and
  `test-name-verifies-claim` (0.62) -- each fitted on its own fixtures over
  three passes. Precision 1.00 on every one; recall 1.00 on every one but
  `comment-describes-block`, which misses a unit claim (30,000 milliseconds
  under "one minute") its rule file records. They ship in the package and
  load anywhere; a run whose config does not name a MoonBit parser drops
  them and names the language. `npm run parsers:moonbit` builds one, and
  `docs/moonbit.jev-lint.yaml` is the config their suites run under.
- `languages:` in the config declares a grammar ast-grep does not have
  built in -- a tree-sitter parser compiled to a dynamic library, as
  ast-grep's own `customLanguages` takes it. A rule may then name it, a
  rule directory may be called it, and jev-lint writes ast-grep an
  `sgconfig.yml` per run with the library path resolved from the config's
  directory. Structural probes ship for `moonbit`
  (moonbitlang/tree-sitter-moonbit), so `subject: enclosing`, the `graph`
  arm and the `paired` arm work there; any other declared language runs on
  `bare` and `located`. The caveats each language brings -- the name must
  match the declaration exactly, `expandoChar` or no patterns, fields may
  not exist -- are in `docs/reference.md`.

### Fixed

- **`eval` reported a suite as measured when it was not.** A batch whose
  request fails yields a null answer per subject — fail open, which is
  right — and `runEval` then wrote those nulls into the record and said
  nothing. `scoreEval` computes precision and recall over whatever came
  back, so a run that answered three of ten subjects printed the same kind
  of table as one that answered ten, and in the whole-run case (`0
  request(s)`, `$0.00000`, every value null) `eval --replay` reported the
  suite as "all as shipped" with tp, fp and fn all zero. Building the
  shell pack, four agents hit this independently through a stretch of HTTP
  529s. Now: a run that came back with holes says how many and why,
  `--accept` refuses to write a baseline with holes in it, and a replay
  over a baseline that already has some says so every time it reads one.
- The notice for a language whose parser nobody declared now says where to
  read about declaring one, and `docs/reference.md` is in the published
  package so an installed user can. The behaviour it describes was already
  right and is covered by tests: the `moonbit` rules load from the package
  like any other (`rules/**/rule.yml` ships; the parser is a platform
  library and does not), a repository with `.mbt` files and no `languages:`
  has those rules dropped and the language named, and a repository with no
  `.mbt` file at all gets no notice — the rules are simply not scanned.
- `Pacer` drained its bucket when the clock went backwards. `refill`
  subtracted the negative elapsed time, so an NTP step or a laptop waking
  from suspend took a second's worth of tokens — 200,000 at the shipped
  rate — out of a bucket the server never touched, and the client then
  waited for a limit that was not being imposed: no 429, `rateLimited`
  still zero, the run just slower for no visible reason. Elapsed time is
  now clamped at zero; `at` still moves, because leaving it in the future
  after a permanent step would stall the bucket for longer than the bug
  did. Reported from jev-test-filter, which hit it by mixing `take()`
  against the wall clock with frozen-clock `delay(n, t)` calls.

## 0.5.0 — 2026-09-21

### Breaking

- The config selects the rules, as ESLint's does. `rules:` is a mapping of
  rule id to `on` / `off` / a severity / `{ severity, at, loose }`; an id
  names the rule in every language that has it, `lang/id` one. A name that
  matches no loaded rule is an error. A config with no `rules:` runs
  nothing and says what to write; with no config, every loaded rule runs.
  `paths:` is `files:`; `at:` moved under each rule; the old keys are
  refused with the new spelling. `jev-lint init` writes `files:` and every
  shipped rule on.
- A project's own rules live in `.jev-lint/rules/` and add to the shipped
  set; `./rules/` is nothing to the tool. `-R <dir>` loads a directory in
  place of both for one run.
- The verdict cache is `.jev-lint/baseline.json`, relative to the config's
  directory. `.jev-lint-cache.json` is not read, and a run that finds it
  says to delete it.

### Added

- `--json` (`--format json`) for every command, one document on stdout and
  nothing else there: `--dry-run` (the plan, the price per rule, the
  subjects), `rules`, `gaps`, `calibrate` (gaps, stability, fits), `eval`
  in its four modes, `init`. `gaps` and `eval` printed their text and then
  their JSON; an empty `review` under `--json` is an empty document, not
  a sentence.

### Fixed

- `replay --format json` printed the gap table and its trailer after the
  JSON document; a consumer parsing stdout got two documents. The gap rows
  are in the document (`gaps`) and the rest goes to stderr.

### Changed

- `main(argv, deps)`: the model client and the two output streams are
  injectable, so every command that asks the model -- `check`, `review`,
  `commits`, `gaps`, `calibrate`, `eval` -- runs under test exactly as
  the terminal runs it, against a client that answers without a network:
  exit codes, reports, records, baselines. The paired arm follows one hop
  of imports, so a module driven through an entry point counts as tested.
- The test files run one at a time: static imports of modules with
  top-level `await` are evaluated in parallel, and a test that changed
  the working directory changed it under another file's test.
- The CLI's commands have tests of their own: `main`'s exits before any
  command, `init` and its hooks, `replay`'s refusals, `rules`; and
  `readEvalRecord`'s nulls. A line of ast-grep's output that is not a
  match is counted and said, not skipped in silence. Names the self-lint
  called wrong: `stale` (a list of rule ids) is `changedDrafts`.

## 0.4.3 — 2026-09-21

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

- `Rule` is a discriminated union: `RuleBase & RuleJudgment & RuleSource`,
  where a `kind: noul` rule carries `criteria` and a `kind: score` rule
  `levels`, and a matcher rule carries `matcher` / `constraints` / `utils`
  while a `commit` rule carries none and a `block` rule `split` /
  `extensions`. Narrowing on `rule.kind` and `rule.subject` replaces the
  `!` assertions; `normalizeRule` is three validators (base, judgment,
  source) that assemble it. A commit or block rule's `matcher` is null, not
  `{}`; the draft hash treats it as before, so no baseline retired.
- `src/cli.ts` (1,418 lines, `main` alone 278) is `src/cli/`: one module
  per step -- `args`, `context`, `select`, `targets`, `dry-run` -- and
  one per command (`cmd-check`, `cmd-eval`, ...; the prefix so that none
  shares a stem with the module it drives, which the `paired` arm pairs
  on), with `main.ts` only the order they happen in. The two places a
  positional and a config path had been the same variable are two named
  values, and the steps have tests of their own. `dist/cli.js` is still
  the bin.
- What the tool said about its own code, acted on: one `tryReadFile` /
  `tryReadDir` where five modules each swallowed a read error in their
  own words; `computeCalls` that assigned is `linkCalls`, `toRecord` that
  read the clock is `buildRecord`, `parseArgs` no longer reads the
  `--message-file` or the terminal; a `FileIndex.list(roots)` that
  returned more than the roots is `extend`; three comments that had
  drifted from their code; tests for the failure paths of `runAstGrep`,
  `defaultRange`, `loadSuite`, `planEval` and `collectRows`. 42 findings
  on the tree, then 13, the rest within 0.05 of a cutoff or arguable.
- A file that defines `test` is not a test file: the suite's harness under
  `test/` paired with every module and took a share of every excerpt. The
  harness is `test/harness.ts`, the fixture builders `test/builders.ts`.
- `evalCorpus` (the experiments' corpus) reports a suite whose expect file
  does not parse instead of dropping it in silence; the tools print it.
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
