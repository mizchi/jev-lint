# jev-lint

A linter for the things a linter could never check: whether a function does
what its name says, whether a comment is still true, whether a test verifies
what it claims.

```
corpus/ts/cart.ts
     21  flag       The body of this function does something materially different from what its name promises.
         fn-name-promises  0.93  cutoff 0.76  arm located

corpus/ts/cart.test.ts
     27  flag       This test would still pass if the behaviour its name claims were broken.
         test-name-verifies-claim  0.95  cutoff 0.54  arm bare

corpus/ts/session_store.ts
     20  flag       The comment above this code claims something that is not true of the code.
         comment-describes-declaration  0.97  cutoff 0.83  arm located

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
  at: 0.76
```

The matcher is exact, free and runs locally; it decides **which code is looked
at** — every named function — and hands over `$NAME`. The sentence decides
**whether it is a problem**, and is answered by [Jev](https://typesafe.ai), a
model built to score a statement about a piece of text rather than to chat.
No parser can say whether `applyDiscount` also saves the cart; a reader who
sees the name and the body can, and so can the model, with the file for
context. `state: located` is that file, `kind: noul` says the answer is a
probability that the statement holds, and `at: 0.76` is the cutoff fitted to
a labelled corpus.

What makes that affordable is batching. The matches in a file travel together
in a request that carries the file once and each question only as its own
text, packed under a token budget the planner measures before sending.
`--dry-run` prints the plan and the price for your code without sending
anything. On this repository's own source one full pass is 1,403 subjects in
67 requests for about five cents.

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

**In CI, use review mode.** It judges only the lines a diff touched, which is
where the findings concentrate anyway, and it costs a fraction of a cent:

```bash
jev-lint review --base "$GITHUB_BASE_REF" --format github
```

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

## Rules

Two packs ship in `rules/`, used when the project has no `rules/` directory
of its own. Each rule exists in an ECMAScript and a Rust variant sharing one
sentence, 15 rules in all.

**`naming.yml`** — does the code do what it calls itself?

| rule | asks |
| --- | --- |
| `fn-name-promises` | does this function's body do what its name promises? |
| `var-name-describes-value` | does this binding's name describe the value bound to it? |
| `test-name-describes-code` | does this test's code do what its name says? |
| `test-name-verifies-claim` | would this test still pass if the behaviour its name claims were broken? |
| `module-name-describes-contents` | is this module named for what it contains? |

**`comments.yml`** — is the comment still true?

| rule | asks |
| --- | --- |
| `comment-describes-declaration` | does the comment above this declaration still hold? |
| `comment-describes-block` | does a comment inside a body describe the lines under it? |

Deliberately not asked: style, redundancy, whether a comment should exist.
One axis only — is the claim false.

On the corpus the cutoffs were fitted to, 12 of the 15 rules reach precision
and recall 1.00; three do not separate at any cutoff and ship with a note
saying so, two of them at `severity: info`. The counts behind those numbers
are small — 41 labelled defects across the 12 — and the full table, with what
the packs found on this repository's own code, is in
[docs/reference.md](docs/reference.md#the-shipped-packs).

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
