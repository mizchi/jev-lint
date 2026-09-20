# Using the shipped rules

jev-lint ships 23 rules in the npm package's `rules/` directory, one
directory per rule (family) with `rule.yml` and the `evals/` that prove it.
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

**Messages** — `log-level-matches-event`: does the level of a
`logger.<level>(...)` call match the severity of the path it sits on?
`local`.

**Config** — `script-name-does`: does a `package.json` script's name
describe the command it runs? JSON, `bare`.

Not asked, deliberately: style, redundancy, whether a comment should exist.
One axis only — is the claim false.

The naming and comment rules each have an ECMAScript variant (`TypeScript, Tsx, JavaScript, Jsx`) and a
Rust variant (`-rust`) sharing one sentence; `comment-describes-declaration`
also has a `-js` variant, because JavaScript has no type declarations to
match. **On a TypeScript-only repository 8 of the 23 rules report "matched
nothing"** — the seven Rust variants and the `-js` one. That line is expected
there, and nowhere else.

The two test rules are nested, not orthogonal: a test that exercises the wrong
case also fails to establish its name, so both fire on that class and only
one fires on a weak assertion.

## How the packs are found

| situation | what is used |
| --- | --- |
| `./rules` exists | `./rules`, and only that |
| no `./rules` | the packs inside the installed package, and jev-lint says so on stdout because their cutoffs were fitted to *its* corpus |
| `-R <path>` (repeatable) | exactly those paths, files or directories |
| `rules: [...]` in `.jev-lint.yaml` | those, unless `-R` is passed |

So the zero-configuration path is: install nothing, run `npx -y jev-lint
check src`, get the packs.

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
at:
  var-name-describes-value: 0.7
  fn-name-promises: 0.8
```

`at:` in the config merges: overriding one rule leaves the others at their
shipped values. This is the right first move when a rule is noisy on your
code — the shipped cutoff sits where the corpus's clean band ended, and real
code's clean band goes higher. `var-name-describes-value` and
`module-name-describes-contents` are the two with the least headroom and the
first to refit.

### 2. Copy them and edit

```bash
mkdir -p rules
cp -R node_modules/jev-lint/rules/fn-name-promises rules/   # one rule, with its evals; or all of them
```

Now `./rules` exists and the packaged copies are ignored entirely. Delete the
rules you do not want, change `severity:`, rewrite `criteria:` for your
domain, add `note:` with your exceptions. Two things to know before editing:

- **Editing `ask`, `criteria`, `note`, `rule`, `subject` or `state`
  invalidates that rule's cached verdicts** — it is a new question. Editing
  `at` or `severity` invalidates nothing. Recalibration is free by design.
- **Rules that share a sentence share it by YAML anchor** (`&fn_ask` /
  `*fn_ask`). Edit the anchor and both variants follow. Anchors are scoped to
  one YAML document, so keep a rule and its `-rust` twin in the same file.

Dropping a language variant is a deletion, not a `languages:` edit: the Rust
rule names Rust node kinds, and ast-grep rejects a kind absent from the target
grammar — one rejected rule fails the whole scan.

### 3. Combine with your own

```bash
jev-lint check src -R node_modules/jev-lint/rules -R rules/mine.yml
```

```yaml
# .jev-lint.yaml
rules:
  - node_modules/jev-lint/rules
  - rules/mine.yml
```

Ids must be unique across every source; a duplicate is a validation error
naming both files. Prefix your own (`acme-...`) to make the split visible in
reports.

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

Fitted on each rule's own evals (`rules/<id>/evals/`, 200 labelled defects
across the 23 rules, three passes each). 20 of the 23 reach precision and
recall 1.00 at their shipped cutoffs; the three that do not each miss one
labelled defect the rule file names — a binding holding one branch of a
union result, a Rust field taken under another field's name, an inline
comment that is only false together with the loop after it. Read all of it
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

Review mode judges only the lines the diff touched. Commit
`.jev-lint-cache.json` if you want reviewers to see the verdicts you saw and
CI to re-gate without a key; treat it as trusted input in review, since
anything that edits it can silence a rule.

Locally, `jev-lint init --pre-commit` writes a hook that runs
`review --staged --fail-on error` on every commit: the staged diff only,
every finding printed, the commit blocked only by a rule at `severity:
error`. If a hook already exists (husky, a task runner), it prints the one
line to add instead of overwriting.
