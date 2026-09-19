# jev-lint

A linter for the things a linter could never check: whether a function does
what its name says, whether a comment is still true, whether a test verifies
what it claims.

```
corpus/ts/cart.ts
     21  flag       The body of this function does something materially different from what its name promises.
         fn-name-promises  0.93  cutoff 0.83  arm located

corpus/ts/cart.test.ts
     27  flag       This test would still pass if the behaviour its name claims were broken.
         test-name-verifies-claim  0.95  cutoff 0.53  arm bare

corpus/ts/session_store.ts
     20  flag       The comment above this code claims something that is not true of the code.
         comment-describes-declaration  0.97  cutoff 0.75  arm located

45 finding(s), 276 subject(s), 0 cached
37 request(s), 155,249 input tokens, $0.00652, 6848 ms
```

## What it reviews

Conventional lint decides things a parser can decide. The conventions teams
actually argue about in review are not like that:

- **A name that drifted from its implementation.** `applyDiscount` that also
  saves the cart; `timeoutSeconds = 5000`; a test called `rejects an expired
  token` that never passes one.
- **A comment that became a lie.** A doc comment separated from its function
  by a later refactor, still claiming a `null` return the function no longer
  makes.
- **Design consistency.** Whether this module is named for what it contains,
  whether `catch` blocks hide failures, whether a `fetch` has a timeout unless
  it sits inside a retry wrapper that sets one.

All of these are visible only to a reader who understands both the contract
the code declares about itself and the body. jev-lint asks a model that
question, one sentence at a time, and reports what comes back over a cutoff.

It is **not** for anything a compiler, a type checker or ESLint already
decides. A model of this kind is measurably good at code that contradicts
itself and measurably poor at defects that need knowledge of a specific API,
such as `.sort()` defaulting to lexicographic order. Keep your existing tools
for those.

## How it works

A rule is an [ast-grep](https://ast-grep.github.io) matcher plus one sentence.
This is the shipped `fn-name-promises`, abridged:

```yaml
- id: fn-name-promises
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul                # a yes/no predicate with its own cutoff
  rule:
    kind: function_declaration
    has: { field: name, pattern: $NAME }
  ask: >-
    The body of this function does something materially different from what
    its name promises.
  criteria:
    "true": >-
      Someone who read only the name and the parameter list would be wrong
      about what this function does: it changes state when the name says it
      only reads, it can fail when the name promises a value, it handles a
      narrower case than the name claims, or it does substantial work the
      name does not mention.
    "false": >-
      The name and parameter list describe what the body actually does.
  state: located
  at: 0.86
```

The matcher is exact, free and runs locally; it decides **which code is looked
at** — every named function — and hands over `$NAME`. The sentence decides
**whether it is a problem**, and is answered by [Jev](https://typesafe.ai), a
model built to score a statement about a piece of text rather than to chat.
No parser can say whether `applyDiscount` also saves the cart; a reader who
sees the name and the body can, and so can the model, with the file for
context. `state: located` is that file, `kind: noul` says the answer is a
probability that the statement holds, and `at: 0.86` is the cutoff fitted to
a labelled corpus.

What makes that affordable is batching. The matches in a file travel together
in a request that carries the file once and each question only as its own
text, packed under a token budget the planner measures before sending.
`--dry-run` prints the plan and the price for your code without sending
anything. What one full pass over this repository costs is in
[What a full run costs](#what-a-full-run-costs).

## What it is not

It is not deterministic, and it is not always right. Measured on this
repository, about one finding in five was wrong, and a score near a cutoff can
move by a few hundredths between runs. jev-lint is built around that rather
than pretending otherwise:

- **Verdicts are cached** by the content of the rule and the code, so two runs
  over the same commit agree, and CI can lint from a committed cache with no
  API key at all.
- **`--retry 3`** asks everything three times, decides on the mean, and marks
  the findings that did not reproduce in every pass as ones to decide by hand.
  Retries are cheap: the matcher and the plan run once and only the asking
  repeats.
- **Cutoffs are yours to fit.** `jev-lint gaps` shows whether a rule separates
  clean code from defects at all; `jev-lint calibrate --labels` fits the cutoff
  to code you have labelled; `jev-lint replay` re-scores a recorded run under
  new cutoffs for free. The shipped cutoffs are a starting point, fitted to
  this package's corpus and not to yours.

Read a finding as a candidate for a human to judge, not a verdict to act on.

## Quick start

```bash
export TYPESAFE_API_KEY=...
npx -y jev-lint check src --dry-run   # what it would ask, and the price. No request.
npx -y jev-lint check src             # ask it
```

Nothing to install for that. Node 20+. The matcher is the real ast-grep
binary, so every language it supports is available; the shipped rules cover
TypeScript, TSX, JavaScript and Rust.

For a project:

```bash
npm install --save-dev jev-lint
npx jev-lint init                     # writes .jev-lint.yaml, everything commented out
```

Uncomment `paths:` so `jev-lint check` needs no argument. The API key is read
from the environment only, never from that file; `apiKey:` in it is an error.

For Claude Code, the repository is also a plugin: it installs the `jev-lint`
skill (running it, the shipped packs, a rule cookbook, calibration) and two
commands, `/jev-lint:review` and `/jev-lint:new-rule`:

```
/plugin marketplace add mizchi/jev-lint
/plugin install jev-lint@jev-lint
```

**Review the diff, not the tree.** Review mode judges only the lines a diff
touched, which is where the findings concentrate anyway, and costs a
fraction of a cent. In CI:

```bash
jev-lint review --base "$GITHUB_BASE_REF" --format github
```

And before each commit:

```bash
jev-lint init --pre-commit      # writes .git/hooks/pre-commit
```

The hook runs `jev-lint review --staged --fail-on error`: only what the
commit contains, every finding printed, and the commit blocked only by a rule
with `severity: error`. No shipped rule has it, so out of the box the hook
is a reviewer that talks and never refuses; raise a rule to `error` once it
has earned that on your code. Without an API key in the environment it steps
aside. An existing hook is not overwritten; the one line to add to it is
printed instead.

Exit codes: `0` clean, `1` findings, `2` configuration error, `3` requests
failed. With `--format github` a finding is annotated as a `warning` unless
its rule says `severity: error`, and no shipped rule does: a probabilistic
reviewer that can fail a build is one that gets switched off. Raise it per
rule once the rule has earned it on your code.

To silence one finding, or one file:

```ts
// jev-lint-ignore-next-line fn-name-promises
export function summarize(rows: Row[]): Total { … }

// jev-lint-ignore-file
```

A suppressed subject is never sent, so a suppression also saves its tokens.

Two lines of output are never noise. **`N rules matched nothing`** is the only
place a matcher that matches nothing is visible: on a TypeScript-only
repository expect the seven Rust variants there and one JavaScript-only rule,
and nothing else. **`N without a verdict`** means requests failed, and a run with failures never reads as a
clean repository.

Every flag, and the config file's precedence, is in
[docs/reference.md](docs/reference.md#commands-and-flags).

## What a full run costs

This repository lints itself: `.jev-lint.yaml` points the shipped packs at
`src`, `tools`, `test/test.ts` and `package.json`, and leaves out `corpus/`
and the cookbook fixtures, which hold planted defects. One full pass, all 21
rules, nothing cached, on a laptop over a home connection, recorded in
`docs/data/self-lint-2026-09-20.json`:

| | |
| --- | --- |
| subjects judged | 1,950 |
| requests | 71, at concurrency 4 |
| input tokens | 1,316,775 |
| output tokens | 37,444 |
| price | $0.0553 |
| wall clock | 7.7 s (29.2 s of request time, summed) |
| model | `jev-1.13.0`, 2026-09-20 |
| findings | 3 |

That is 2.8 cents per 1,000 subjects. `--dry-run` on the same tree estimated
1,462,466 input tokens, 11.1% above what the server billed, so a dry run is a
bound to budget against rather than a quote. A `review` of one commit's diff
is a different order: the commits behind this README's last rewrite plan to
44,059 tokens, $0.002.

The three findings are all `var-name-describes-value` on test bindings
within 0.16 of its cutoff, and all three are arguable. Earlier passes over
the same tree caught a test whose name promised "exactly one batch" while
its body only counted placements — fixed — and a counter named `passed`
holding a number, renamed; and the first pass with the comment pack's block
rule at its fitted cutoff flagged eleven test preambles, which is why that
rule now ships above its midpoint. `jev-lint replay
docs/data/self-lint-2026-09-20.json` reproduces the table with no API key.

## Rules

Six packs ship in `rules/`, 23 rules, used when the project has no `rules/`
directory of its own. The naming and comment rules exist in an ECMAScript
and a Rust variant sharing one sentence; the rest are ECMAScript or JSON.

**`naming.yml`** — does the code do what it calls itself?

| rule | asks |
| --- | --- |
| `fn-name-promises` | does this function's body do what its name promises? |
| `var-name-describes-value` | does this binding's name describe the value bound to it? |
| `test-name-describes-code` | does this test's code do what its name says? |
| `test-name-verifies-claim` | would this test still pass if the behaviour its name claims were broken? |
| `module-name-describes-contents` | is this module named for what it contains? |
| `module-naming-consistent` | do this module's exports name the same kind of operation with the same words? |

**`guarantees.yml`** — the name makes a specific promise; does the body keep it?

| rule | asks |
| --- | --- |
| `safe-name-is-safe` | `safe*` / `try*` / `*OrNull`: does a failure still escape as a throw? |
| `idempotent-name` | `ensure*` / `upsert*` / `register*`: does a second call do something different from the first? |
| `pure-name-is-pure` | `compute*` / `format*` / `parse*` / `to*`: does the body reach outside itself — mutate an argument, write a cache, read the clock or the environment? |

On the corpus behind this pack, `fn-name-promises` flags none of the 22
labelled defects at its cutoff — the narrower promise separates where the
general question does not.

**`tests.yml`** — tests that cannot verify their name, by construction

| rule | asks |
| --- | --- |
| `test-mocks-subject` | is the behaviour the title claims performed by a stub, with the assertion reading the stub back? |
| `snapshot-only-behaviour-claim` | does the title claim a property that a whole-render snapshot does not isolate? |

**`comments.yml`** — is the comment still true?

| rule | asks |
| --- | --- |
| `comment-describes-declaration` | does the comment above this declaration still hold? |
| `comment-describes-block` | does a comment inside a body describe the lines under it? |

**`messages.yml`** — messages for a human, versus what the code does

| rule | asks |
| --- | --- |
| `log-level-matches-event` | does this log call's level match the severity of the path it sits on? |

**`config.yml`** — names in configuration files (ast-grep parses JSON and YAML)

| rule | asks |
| --- | --- |
| `script-name-does` | does this `package.json` script's name describe the command it runs? |

Deliberately not asked anywhere: style, redundancy, whether something should
exist. One axis only — is the claim false.

On the corpus the cutoffs were fitted to, 22 of the 23 rules reach precision
and recall 1.00; the one that does not ships with a note in the pack saying
what it misses. The counts behind those numbers are small — under ten
labelled defects per rule — and the full table, with what the packs found on
this repository's own code and on an unseen one, is in
[docs/reference.md](docs/reference.md#the-shipped-packs). Seven more rules
were built and measured the same way and not shipped; their reports are in
`experiments/rule-candidates/`.

## Adding your rule

Put a YAML file in `rules/`. Everything ast-grep understands works in `rule:`
unchanged — `pattern`, `kind`, `regex`, `all`/`any`/`not`, `inside`/`has`,
`utils`, `constraints`:

```yaml
- id: catch-hides-failure
  languages: [TypeScript, Tsx]
  rule:
    kind: catch_clause
  subject: enclosing          # judge the function around the match, not the clause
  ask: This catch block swallows a failure the caller needed to know about.
  note: logging and rethrowing is fine; returning a default silently is not.
  severity: info
```

Three decisions shape whether a rule works, and each is a field:

| field | choices | the question it answers |
| --- | --- | --- |
| `rule` | any ast-grep matcher | which code is looked at. **Over-match on purpose**: a node the matcher misses is never asked about, and the model saying "irrelevant" is cheaper than a tight matcher |
| `subject` | `node` (default), `enclosing`, `file` | what code is judged. The most common failure is asking about code that cannot contain the answer; a `catch` clause alone cannot show whether the failure mattered |
| `state` | `bare`, `local`, `located` (default), `graph`, `full` | what else the model sees. Not a quality knob: the least context that still contains the answer |

Capture names when the rule is about a name. `has: { field: name, pattern:
$NAME }` hands `$NAME` to the model by name, and "does this body do what
`$NAME` promises" is a sharper question than "is this well named".

Then check it does something:

```bash
jev-lint rules                                      # loaded, or the validation error
jev-lint check src --dry-run --show-subjects        # which nodes it found, with captures
jev-lint check src --at catch-hides-failure=2 --retry 3   # a score runs 0-3
```

### Calibrating

A cutoff is fitted, not chosen. Label a handful of defects as comments next
to the code (`// DEFECT (catch-hides-failure): reason`) and derive a labels
file from them — this repository's `corpus/build-labels.ts` does that, so line
numbers cannot drift — then:

```bash
jev-lint gaps corpus                    # does the rule separate the classes at all?
jev-lint calibrate corpus --labels corpus/labels.json --repeat 3 --record run.json
jev-lint replay run.json --labels corpus/labels.json    # refit later, free
```

`gaps` answers the question to ask first. `works` means any cutoff inside the
gap gives the same answers; `move` means the rule discriminates and the
threshold is misplaced; `rewrite` means the answers are not separated and no
cutoff helps — rewrite the sentence, or check whether the subject can show
what it is being asked. Write the fitted number into the rule as `at:`, and
record anything you will quote: a cutoff is a claim about a specific set of
answers, and `replay` lets anyone re-derive it without an API key.

Every field, `score` versus `noul`, the state arms with their measurements,
and sharing one sentence across grammars are in
[docs/reference.md](docs/reference.md#rule-fields).

## Further reading

| | |
| --- | --- |
| [docs/reference.md](docs/reference.md) | every flag and field, calibration in full, the batching axis, what to expect on real code, limits |
| [docs/deepdive.md](docs/deepdive.md) | everything measured that is still true, and the evidence for it |
| [docs/internal.md](docs/internal.md) | how the code works, for changing it |
| [docs/findings.md](docs/findings.md) | the notebook, in the order it happened, including the wrong turns |

## Prior art

The idea of asking a model a lint question comes from
[mizchi/jev-playground](https://github.com/mizchi/jev-playground)'s
`eslint-plugin-jev`. What is different here: relational multi-language matchers
instead of single-node ESLint selectors, a custom runner instead of ESLint's
synchronous per-file callback, diff-scoped review mode, the state arm as a
measured axis rather than a fixed choice, and record/replay so a threshold is
auditable.

MIT.
