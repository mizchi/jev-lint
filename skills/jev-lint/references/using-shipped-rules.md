# Using the shipped rules

jev-lint ships 65 rules in the npm package's `rules/` directory, one
directory per rule under its language (`rules/typescript/<id>/`,
`rules/rust/<id>/`, …) with `rule.yml`, the `fixtures/` that prove it and
`expect.yml`.
They are the rules to start from: each one has a cutoff fitted to a labelled
corpus, a `state` arm chosen by measurement, and a `criteria` block that took
several rounds to get right. Write your own only for a convention they do not
cover — see [cookbook.md](cookbook.md).

## What ships

**Naming** — does the code do what it calls itself?

| rule | asks | subject | state |
| --- | --- | --- | --- |
| `fn-name-promises` | does this function's body do what its name promises? | every named function, method, or function-valued binding | `located` |
| `var-name-describes-value` | does this binding's name describe the value bound to it? | `const`/`let` with an initializer that is not a function | `located` |
| `test-name-describes-code` | does this test's code do what its name says? | `it(...)` / `test(...)` calls | `bare` |
| `test-name-verifies-claim` | would this test still pass if the behaviour its name claims were broken? | same | `bare` |
| `module-name-describes-contents` | is this module named for what it contains? | the file, as an outline | `graph` |
| `module-naming-consistent` | do the exports name the same kind of operation with the same words? | the file, as an outline with signatures | `graph` |

**Comments** — is the comment still true?

| rule | asks | subject | state |
| --- | --- | --- | --- |
| `comment-describes-declaration` | does the comment above this declaration still hold? | a declaration with a comment directly above it | `located` |
| `comment-describes-block` | does a comment inside a body describe the lines under it? | a statement with a comment directly above it, inside a block; judged with its enclosing function | `bare` |
| `doc-errors-match-body` | does the doc's failure contract (`@throws`, `Raises:`, `# Errors` / `# Panics`) match the body? | a function whose doc comment makes a failure claim | `located` |

**Guarantees** — a name that makes a specific promise

| rule | names | asks | state |
| --- | --- | --- | --- |
| `safe-name-is-safe` | `safe*`, `try*`, `*OrNull`, `*OrDefault`, `*OrUndefined` | does a failure the name absorbs still escape as a throw? | `local` |
| `idempotent-name` | `ensure*`, `upsert*`, `setup*`, `install*`, `register*` | does a second call leave a different result from the first? | `located` |
| `pure-name-is-pure` | `compute*`, `calculate*`, `derive*`, `format*`, `to*`, `parse*` | does the body mutate an argument, cache its own result, or read the clock / environment / a random source, even on a fallback path? (`info`) | `local` |

Narrower cousins of `fn-name-promises`, which flags none of their labelled
defects at its own cutoff: a specific promise separates where "does the body
match the name" does not.

**Tests** — tests that cannot verify their name, by construction

| rule | asks | state |
| --- | --- | --- |
| `test-mocks-subject` | is the claimed behaviour performed by a stub, with the assertion reading the stub back? | `located` (the `vi.mock` at the top of the file is the evidence) |
| `snapshot-only-behaviour-claim` | does the title claim a property a whole-render snapshot does not isolate? | `located` |
| `tests-cover-failure-paths` | does this exported function have a failure path (throw, rejection, error result, guard) that none of the file's related tests reaches? | `paired` (excerpts of the related tests; a file with no related test yields no subject and is counted as `unpaired`) |

**Messages** — `log-level-matches-event`: does the level of a
`logger.<level>(...)` call match the severity of the path it sits on?
`local`. `log-message-matches-event`: does its message describe the event
on that path? `local`. `error-message-matches-condition`: does a `throw`'s
message describe the condition the guarding `if` checked? `local`.

**Also**: `type-name-describes-shape` (a type's name against its members,
`located`); `catch-hides-failure` (a `catch` that returns a default or only
logs in a function not named `safe*`/`try*`/`*OrNull`, `local`);
`query-name-describes-sql` (an sqlc `-- name:` against its SQL, the one
`subject: block` rule, `located`); `commit-message-describes-diff` (run by
`jev-lint commits`).

**Config** — `script-name-does`: does a `package.json` script's name
describe the command it runs? JSON, `bare`.

Not asked, deliberately: style, redundancy, whether a comment should exist.
One axis only — is the claim false.

The naming and comment rules each exist under `typescript/` (`TypeScript,
Tsx, JavaScript, Jsx`), `rust/`, `python/` and `go/` where the port
separated, same id, same sentence; `comment-describes-declaration` also
exists under `javascript/`, because JavaScript has no type declarations to
match; `must-name-panics` exists only under `go/`. On a repository with
one language the report prints one line per language it saw no file of —
`no files for python (11 rules), go (9), rust (7)` — and those rules are
idle, not silent. **The `matched nothing` line names only the rules of a
language the run did see**, and that line is the one to check.

The two test rules are nested, not orthogonal: a test that exercises the wrong
case also fails to establish its name, so both fire on that class and only
one fires on a weak assertion.

## How the packs are found, and which run

The rules load from the packs inside the installed package and, when the
directory exists, the project's own `.jev-lint/rules/`. Which of them run
is the config's decision, as ESLint's is:

| situation | what runs |
| --- | --- |
| no `.jev-lint.yaml` | every loaded rule, and jev-lint says so on stderr because the packs' cutoffs were fitted to *its* corpus |
| `.jev-lint.yaml` with `rules:` | only the rules it names and turns on, with the severity / cutoff / loose floor it gives them; a name that matches nothing is an error |
| `.jev-lint.yaml` without `rules:` | nothing, and the run says what to write |
| `-R <path>` (repeatable) | exactly those files or directories, in place of the packs and `.jev-lint/rules/`, for that run |
| `run <id>` | that rule from the packs or `.jev-lint/rules/`, whatever the config says |

So the zero-configuration path is: install nothing, run `npx -y jev-lint
check src`, get the packs. The configured path is `jev-lint init`, which
writes `files:` and every shipped rule on, to prune.

## Three ways to adopt them

### 1. Use them as they are

```bash
npx -y jev-lint check src --dry-run     # count and price first
npx -y jev-lint check src
```

Adjust a cutoff without touching the pack, per run or in the config:

```bash
jev-lint check src --at var-name-describes-value=0.7 --at fn-name-promises=0.8
```

```yaml
# .jev-lint.yaml
rules:
  var-name-describes-value: { at: 0.7 }
  fn-name-promises: { at: 0.8, severity: error }
  rust/fn-name-promises: off
```

A rule's entry overrides that rule and leaves the others at their shipped
values. This is the right first move when a rule is noisy on your
code — the shipped cutoff sits where the corpus's clean band ended, and real
code's clean band goes higher. `var-name-describes-value` and
`module-name-describes-contents` are the two with the least headroom and the
first to refit.

### 2. Copy one and edit

```bash
mkdir -p .jev-lint/rules/typescript
cp -R node_modules/jev-lint/rules/typescript/fn-name-promises .jev-lint/rules/typescript/acme-fn-name-promises
```

Give the copy its own id (`acme-...`; a copy with the shipped id is a
duplicate and the loader says so), turn the shipped one off in `rules:`
and the copy on, then rewrite `criteria:` for your domain and add `note:`
with your exceptions. Two things to know before editing:

- **Editing `ask`, `criteria`, `note`, `rule`, `subject` or `state`
  invalidates that rule's cached verdicts** — it is a new question. Editing
  `at` or `severity` invalidates nothing. Recalibration is free by design.
- **A rule in two languages is two files with one id** (`rules/typescript/<id>`,
  `rules/rust/<id>`). The sentence is a copy; the loader warns when the copies
  drift, so edit both, or declare in `divergent:` why one of them has to say
  something else.

Dropping a language variant is a deletion, not a `languages:` edit: the Rust
rule names Rust node kinds, and ast-grep rejects a kind absent from the target
grammar — one rejected rule fails the whole scan.

### 3. Add your own beside them

A rule file under `.jev-lint/rules/` -- flat, or `<language>/<id>/rule.yml`
with fixtures beside it -- loads with the packs, and is named in `rules:`
like any of them:

```yaml
# .jev-lint.yaml
rules:
  fn-name-promises: on
  acme-endpoint-names-resource: warning     # .jev-lint/rules/acme-endpoint-names-resource.yml
```

Ids must be unique across every source; a duplicate is a validation error
naming both files. Prefix your own (`acme-...`) to make the split visible in
reports. For one run over a directory of rules and nothing else: `-R <dir>`.

## Picking a subset

There is no per-rule enable flag. Pick directories:

```bash
jev-lint check src -R node_modules/jev-lint/rules/fn-name-promises -R node_modules/jev-lint/rules/test-name-verifies-claim
```

or copy (way 2) and delete. To silence a rule in one file without changing
the rules, use a suppression comment:

```ts
// jev-lint-ignore-file comment-describes-block
```

## What the shipped cutoffs are worth

Fitted on each rule's own fixtures (`rules/<lang>/<id>/`, 467 labelled defects
across the 65 rules, three passes each). 56 of the 65 reach precision and
recall 1.00 at their shipped cutoffs; the seven that do not each miss one
labelled defect the rule file names — a binding holding one branch of a
union result, a Rust field taken under another field's name, an inline
comment that is only false together with the loop after it, and their
Python and Go cousins. Read all of it
as "separates the classes in a small set of cases", not as a guarantee. The
cases are marker-free; the fits produced while `// DEFECT` lines sat above
each defect were better than the rules.

The four newer packs were also run once over an unseen repository of 1,391
subjects before shipping; their findings there are in the pack headers.

On unseen code expect the clean band to be higher than the corpus's. That is
the documented procedure, not a caveat: run, read the findings, and refit the
two or three rules that produced false positives with
[calibration.md](calibration.md).

## In CI

```yaml
- run: npx -y jev-lint review --base "origin/${{ github.base_ref }}" --format github
  env:
    TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
```

Review mode judges only the lines the diff touched. The cache,
`.jev-lint/baseline.json`, is meant to be committed: reviewers see the
verdicts you saw and CI re-gates without a key; treat it as trusted input
in review, since anything that edits it can silence a rule.

Locally, `jev-lint init --pre-commit` writes a hook that runs
`review --staged --fail-on error` on every commit: the staged diff only,
every finding printed, the commit blocked only by a rule at `severity:
error`. If a hook already exists (husky, a task runner), it prints the one
line to add instead of overwriting.
