# jevlint

A linter whose rules are sentences.

```
corpus/ts/cart.ts
     21  flag       The body of this function does something materially different from what its name promises.
             fn-name-promises  0.95  cutoff 0.67  arm located
     65  flag       This binding's name misdescribes the value it is bound to.
             var-name-describes-value  0.95  cutoff 0.59  arm located

corpus/ts/cart.test.ts
     26  flag       This test does not verify the behaviour its name describes.
             test-name-matches-body  0.98  cutoff 0.69  arm bare

corpus/ts/utils.ts
      1  flag       This module's name does not describe what the module contains.
             module-name-describes-contents  0.84  cutoff 0.59  arm graph

27 finding(s), 134 subject(s)
24 request(s), 76,643 input tokens, $0.00322, 4313 ms
```

**[ast-grep](https://ast-grep.github.io) decides which code gets looked at. A
sentence you write decides whether it is a problem. [Jev](https://typesafe.ai)
answers the sentence** — every match in a file in one batched request, in a few
hundred milliseconds.

The division of labour is the whole idea:

| | who does it | how it fails |
| --- | --- | --- |
| `rule:` | ast-grep's matcher — exact, free, no model involved | **silently**: a node it misses is never asked about |
| `ask:` | Jev, once per matched node | loudly: every answer is visible in `jevlint gaps` |

Half of any team's conventions never become lint rules for the same reason: the
matcher is trivial and the predicate is a week of AST work.
`CallExpression[callee.name='fetch']` takes ten seconds. "…without a timeout,
unless it is inside a retry wrapper that sets one" never gets written. So write
the matcher as code and the predicate as one sentence.

## What it is *not* for

Anything a compiler, a type checker or a conventional linter can decide
mechanically. That is not a scoping convenience, it is where this actually
works: a model of this kind is good at code that **contradicts the contract it
declares about itself**, and measurably *poor* at defects needing knowledge of a
specific API's behaviour — that `.sort()` defaults to lexicographic order, that
a regex without `/g` matches once. Those belong to your existing tools. Use this
for the other half, which has no tool at all.

## Install

```bash
npm install jevlint
export TYPESAFEAI_API_KEY=...
npx jevlint check src
```

Node 20+, two runtime dependencies (`@ast-grep/cli` and `yaml`). The matcher is
the real `ast-grep` binary, so every language it supports is available — the
shipped packs cover Rust, TypeScript, TSX and JavaScript.

### From this repository

```bash
npm install
npm run build          # tsc -> dist/, with .d.ts and source maps
npm run ci             # labels + typecheck + 96 tests + build + offline replay and refit
npm test               # no API key needed
```

Source is TypeScript and ships compiled. The source imports `./x.ts` and the
emit rewrites those to `./x.js`, so the same files run three ways with no
divergence: through `tsc` for the published build, through
`node --experimental-strip-types` for development with no build step, and from
`dist/` once installed. `erasableSyntaxOnly` is on to keep that true — anything
TypeScript cannot simply erase is a compile error here.

## Use

```bash
jevlint check src                  # judge whole files
jevlint review --base main         # judge only what the diff touched
jevlint review                     # ...or what is uncommitted, including untracked files

jevlint gaps src                   # per-rule separation -- read this before any threshold
jevlint calibrate src --labels corpus/labels.json --repeat 3
jevlint rules                      # what loaded, and every validation error
jevlint replay run.json            # re-score a recorded run under new cutoffs, free
jevlint replay run.json --labels corpus/labels.json   # ...and re-fit them, free

jevlint check src --dry-run        # plan and price it without asking anything
```

Review mode is the one to reach for in CI. It scans only the changed files and
keeps only the matches whose subject overlaps a changed line, so a
four-function diff costs **2 requests and $0.00013**. Exit codes: `0` clean,
`1` findings, `2` configuration error, `3` requests failed and nothing was
reported.

```bash
jevlint review --base "$GITHUB_BASE_REF" --format github
```

## Writing a rule

A jevlint rule is an ast-grep rule plus `ask:`.

```yaml
- id: fetch-timeout
  languages: [TypeScript, Tsx]
  # Everything ast-grep understands works here unchanged: pattern, kind, regex,
  # all/any/not, the relational inside/has/follows/precedes, utils, constraints.
  rule:
    pattern: fetch($$$ARGS)
  ask: fetch must always be given a timeout, such as AbortSignal.timeout.
  # Context for the model, never shown in the finding. Exceptions go here.
  note: not a violation if it is inside a retry wrapper that already sets one.
  at: 2.0
```

| field | | |
| --- | --- | --- |
| `rule` | required | the ast-grep matcher. **Write it to over-match.** |
| `ask` | required | the predicate, one sentence |
| `language` / `languages` | required | one grammar, or several |
| `kind` | `score` (default) or `noul` | see below |
| `criteria` | `noul` only | `{true: ..., false: ...}` |
| `at` | cutoff | 0–3 for `score`, 0–1 for `noul` |
| `subject` | `node` (default), `enclosing`, `file` | what code is judged |
| `state` | `bare`, `located` (default), `graph`, `full` | what the model also sees |
| `note` | | context for the model only |
| `axis` | `file` or `rule` | pin the batching axis; the scheduler will not overrule it |
| `severity` | `warning` (default) … `error` | `error` fails a build; earn it first |

### `score` or `noul`

Choose by what the answer means, not by preference.

**`score`** for an ordered conclusion — *how badly* this breaks the rule — on a
fixed four-level scale: `not-applicable`, `satisfied`, `arguable`, `violation`.
Level 0 is how the model says "your matcher caught something this rule was not
written about", which is cheaper to read in a report than to prevent by
hand-tightening a matcher. A score also returns a **confidence**, which is what
lets an uncertain verdict be routed to a human instead of dropped.

Asking an ordered conclusion as a `choice` is the mistake this avoids: the
ordering is thrown away, adjacent levels split the probability mass, and the
result arrives as a low confidence indistinguishable from real uncertainty.

**`noul`** for an independent predicate — *whether* something holds. Returns a
bare probability and no confidence, and gets its own cutoff.

### `subject`: what the question is about

The most common way a rule fails is being asked about code that cannot contain
the answer — then every answer lands mid-scale, which looks like a threshold
problem and is not one.

- `node` — the matched node. Right for "this `fetch` has no timeout".
- `enclosing` — the containing function. Right for "this `catch` hides a
  failure", where the predicate needs the body around the match.
- `file` — the module, presented as an **outline**: its path, its public items,
  its imports. The only way to ask "is this module named for what it contains",
  because a file's text never mentions its own path.

### `state`: what else the model sees

One state per file carries every question for that file, which is the entire
cost argument: the file is sent once and each extra question costs only its own
text.

| arm | carries | cost |
| --- | --- | --- |
| `bare` | the matched code and the file's name | cheapest |
| `located` | + the whole file source | — |
| `graph` | + path identity, imports, symbol table with call edges; **no source** | small at any file size |
| `full` | source and graph | hits the 32Ki state budget soonest |

**This is not a quality knob.** More context is not better; it is a choice of
which error you would rather have. The rule that works:

> Give the question the least context that still contains the answer.

Measured on the corpus, `var-name-describes-value` is **not separable at any
cutoff** on `bare` and fully separable on `located` — because `const
timeoutSeconds = 5000` is only wrong if you know 5000 is milliseconds, and that
is visible where the binding is *used*. Meanwhile `test-name-matches-body`
scores 1.00/1.00 on every arm, because the matcher already hands it both the
title and the body. `tools/arms.ts` measures this per rule -- four arms, two passes each, about two cents.

### Matcher captures are the sharpest state available

A rule that captures `$NAME` and `$TITLE` has told the question exactly which
two things it is comparing, and they reach the model by name. "Does this body do
what `$NAME` promises" is answerable; "is this well named" is not. This is why
the naming pack captures names rather than relying on the model to find the same
pair in the text.

### One sentence, several grammars

`languages: [TypeScript, Tsx]` works when the matcher is valid in both. Rust and
TypeScript spell the same structural idea with different node kinds, and
ast-grep **rejects** a kind absent from the target grammar — so those need two
matchers. Share the sentence with a YAML anchor rather than copying it, since
copies drift and a drifted copy is a cache that never hits:

```yaml
- id: fn-name-promises
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  rule: { kind: function_declaration, has: { field: name, pattern: $NAME } }
  ask: &fn_ask The body of this function does something materially different from what its name promises.
  criteria: &fn_criteria
    "true": ...
    "false": ...
- id: fn-name-promises-rust
  language: Rust
  rule: { kind: function_item, has: { field: name, pattern: $NAME } }
  ask: *fn_ask
  criteria: *fn_criteria
```

Anchors are scoped to one YAML document, which is why a rule file may be a
*list* of rules as well as a `---` stream.

## Calibrating

**Read the gap before you touch a threshold.** `jevlint gaps` sorts each rule's
answers and reports the largest step between neighbours:

```
rule                         kind  matched reported cutoff median gap   suggest verdict
fn-name-promises             noul  26      6        0.67   0.10   0.55  0.65    works
var-name-describes-value     noul  42      3        0.59   0.10   0.67  0.61    works
test-name-matches-body       noul  7       4        0.69   0.95   0.48  0.71    works
```

| verdict | what to do |
| --- | --- |
| `works` | nothing. Any cutoff inside the gap gives the same answers. |
| `move` | set the cutoff to `suggest`. The rule discriminates; the threshold is misplaced. |
| `rewrite` | the answers are not separated. **No cutoff helps.** Rewrite the sentence — and first check it is not asking for something the subject cannot show. |
| `silent` | the matcher never fired. Loosen it; this is the only place that is visible. |
| `thin` | too few matches to judge. Not a pass. |

Then fit against labels:

```bash
jevlint calibrate src --labels labels.json --repeat 3
```

`--repeat` re-asks and reports which subjects changed *decision* between
passes. A rule can have a wobbly score and a perfectly stable decision, if the
wobble happens far from the cutoff — that is the good case. A decision sitting
inside the wobble band should not be automated; route it to a person.

Cutoffs are **per rule, never shared**. Same-shaped questions have been measured
answering their own defect class anywhere between 0.20 and 0.94; the quiet ones
are not broken, they simply never reach a common threshold.

Re-gating is free — `jevlint replay` re-scores a recorded run under new cutoffs
with zero requests, and with `--labels` re-fits them too — so a recorded run
also pins the numbers in any report you publish. Without that, recalibrating
silently rewrites history. It is also how a cutoff stays auditable: the number
is a claim about a specific set of answers, and whoever holds the record can
re-derive it without an API key.

### The corpus is the investment

The thresholds shipped in `rules/naming.yml` are fitted to `corpus/`, which
makes them an opinion about that corpus and a starting point on your code.
Build your own: label defects as comments next to the code
(`// DEFECT (rule-id): reason`) and let `corpus/build-labels.ts` derive the
JSON, so line numbers cannot drift.

And make sure it contains the **hard** clean cases. The first version of this
corpus had clean cases that were all trivially clean, topping out at 0.36
against a defect band starting at 0.92 — which made a cutoff of 0.61 look safe
by a wide margin, until the first unseen function produced a false positive at
0.69. A hole for a class the corpus does not contain is invisible from inside
the corpus, however good the numbers look.

## Batching: one state per file, or one per rule?

The state can be built two ways, and the choice is not free.

- **`--group file`** (default) — one state per file: its source, then every
  match in it. The source is amortised over the matches.
- **`--group rule`** — one state per rule: only what the matcher caught, from
  anywhere. No file is ever sent whole. Note what this does and does not carry:
  the `local` arm attaches a match's enclosing function only when the match is a
  *fragment* inside one, so a rule whose subject is already a whole function
  (`fn-name-promises`) gets no context at all and is effectively on `bare`.
- **`--group auto`** — cost both per rule before asking anything, and pick.
  `--explain-schedule` prints what it decided and why.

Planned on real repositories with `--dry-run` (free), **both shipped packs, at
the cap that actually ships** (`--rule-batch-cap 32`):

| | file axis | rule axis @32 | |
| --- | --- | --- | --- |
| tokio, 10,886 subjects | 896 req / 5.94M tok | **268 req** / 5.02M tok | 3.3× fewer requests, −15.5% tokens |
| vue, 19,659 subjects | 1,739 req / 15.01M tok | **671 req** / 14.26M tok | 2.6× fewer requests, −5.0% tokens |

At an uncapped batch of 256 it is 11.2×/−16.2% and 7.8×/−5.7% — those are the
numbers an earlier version of this section quoted, and they describe a
configuration nobody runs. Since the API prices tokens, **the rule axis buys
latency and rate-limit headroom, not money**, and at the shipped cap it buys
less of both than the uncapped figures suggest.

And it costs accuracy — less than first reported, and mostly through the
**cutoff**. Over 276 corpus subjects the two axes disagree on 1.4% of decisions.
Judged at the shipped cutoffs, which were fitted on the file axis, the rule axis
scores 42/2/5 against the file axis's 43/1/4. Refit on its own answers it
recovers most of that (44/3/3 against 45/1/2): **1 fewer true positive and 2
more false positives out of 276**, on too few events to size. An earlier version
of this section said "2.5× the false positives"; that compared two axes at one
axis's cutoffs, and is retracted.

The residue is structural. A rule-axis state spans files, so it cannot carry
one, and the `located` arm degrades to `local` — which removes the evidence from
exactly the rules whose evidence is the file. One rule, `fn-name-promises-rust`,
separates cleanly on the file axis and has **no separating cutoff** on the rule
axis: fitting cannot put a missing file back.

So the accurate axis is the default, the cheap one is opt-in, the scheduler
refuses to move a rule on a file-bearing arm, and switching axis means
refitting — `jevlint replay <record> --labels <labels>` does that for free from a
recorded run. Pin any rule you calibrated with `axis: file`. Full numbers, including a retracted anchoring claim, in
[docs/findings.md](docs/findings.md#9-batching-axis-one-state-per-file-or-one-per-rule).

## The shipped packs

**`rules/naming.yml`** — does the code do what it calls itself?

| rule | asks |
| --- | --- |
| `fn-name-promises` | does this function's body do what its name promises? |
| `var-name-describes-value` | does this binding's name describe the value bound to it? |
| `test-name-describes-code` | does this test's code do what its name says? |
| `test-name-verifies-claim` | would it still pass if the named behaviour broke? |
| `module-name-describes-contents` | is this module named for what it contains? |

The two test rules are **nested, not orthogonal** — a test that exercises the
wrong case also fails to establish its name — which is why both fire on the
wrong-case class and only one fires on weak assertions. Splitting them was worth
it because a finding can now name which kind it is.

**`rules/comments.yml`** — is the comment still true?

| rule | asks |
| --- | --- |
| `comment-describes-declaration` | does the comment above this declaration still hold? |
| `comment-describes-block` | does a comment inside a body describe the lines under it? |

A comment is a claim in the one notation nothing checks. The matcher pairs the
comment with the code using `follows:` with a pattern — **a `follows` capture
propagates to metavariables** — so `$DOC` names the claim and the matched node
is the code. Both halves named, which is what makes these sharp.

Deliberately *not* asked: style, redundancy, whether a comment should exist. One
axis only, is the claim false. A vague or redundant comment is not a defect.

Each rule ships in a Rust and an ECMAScript variant, sharing one sentence
through a YAML anchor. **13 of 15 reach precision 1.00 and recall 1.00** on the
corpus with no decision flips across passes. The two `comment-describes-block`
rules do not separate and **ship saying so** — cutoffs parked above every
observed answer, `severity: info`, and a note recording what was tried.

On this repository's own 788 subjects the naming pack reports nothing, with the
highest answer anywhere at 0.68 against a 0.69 cutoff.

The two subjects nearest that line were both correct, and both were weak
assertions in this repository's own test suite — a test asserting its ceiling
only inside an `if` that could skip every iteration, and a test titled "every
format" that checked two of three. Neither is something a linter, type checker
or coverage tool would report; coverage called both tests covered.

**[docs/findings.md](docs/findings.md)** has everything measured, including the
three defects the tool found in the corpus I had labelled clean, the five bugs
it and the tests found in itself, and the API's real limits.

## How it behaves when things go wrong

A review tool that can break a build is worse than no review tool, so every
failure path lands on "no verdict":

- A failed request, an unusable answer, a missing or corrupt cache: no finding,
  and the count of missing verdicts is reported in every format. **A run with
  failures never reads as a clean repository.**
- A malformed rule is dropped with a reason, printed loudly. A rule that
  silently failed to load looks exactly like a rule that found nothing.
- A file too large for the 32Ki state budget steps down to a leaner arm, and
  says it did.
- `max_tokens_exceeded` halves the question set and retries, so the token
  estimator only has to be roughly right.

The verdict cache is **trusted input**: anything that can edit it can silence a
rule or invent a finding. Keep it next to your rule files in review, not in a
build-artifact directory. Commit it and CI lints without an API key and
reviewers see the verdicts you saw; leave it ignored and CI pays for a fresh
pass each run.

## Limits

- **Not deterministic.** The cache is what makes two runs agree, which is why it
  is not merely a speed optimisation.
- **The matcher fails silently.** Over-match on purpose; the "N rules matched
  nothing" line is the only place a dead matcher shows up.
- **No editor integration, no autofix.** The economy comes from batching across
  a whole rule set with one state per file, and a linter's rule callback is
  synchronous and per-file. There is no seam for it.
- **The within-file call graph is a name-occurrence test**, not a resolved one.
  It is only ever shown to the model, never used to decide anything.
- **`severity: warning` by default, deliberately.** A probabilistic reviewer
  that can fail a build is a probabilistic reviewer that gets switched off.

## Layout

```
src/types.ts        the shared type surface; unions derived from const arrays
src/rules.ts        rule schema and validation; the draft hash
src/scan.ts         the ast-grep driver, and the structural probes
src/state.ts        the arms, subject resolution, module outlines
src/questions.ts    score and noul question construction
src/batch.ts        token-aware batch planning, both axes
src/schedule.ts     per-rule axis choice, and the constraint that limits it
src/gate.ts         answers -> findings. Pure, offline, free to re-run
src/cache.ts        content-addressed verdicts. Never throws
src/diff.ts         review mode
src/calibrate.ts    gaps, stability, threshold fitting
src/report.ts       pretty / json / github
src/run.ts          the runner
tools/arms.ts       the state-arm experiment
tools/grouping.ts   the batching-axis experiment
corpus/             labeled corpus; labels derived from in-code markers
test/test.ts        86 checks, no API key
```

## Prior art

The idea of a lint rule whose predicate is a sentence, and much of what is known
about using Jev well — questions in one batched request, per-question cutoffs,
confidence as routing rather than a gate, reading the gap instead of the
threshold, record/replay — comes from
[mizchi/jev-playground](https://github.com/mizchi/jev-playground), in particular
its `eslint-plugin-jev` experiment and `docs/practice.md`. This is an
independent implementation on a different substrate: ast-grep instead of ESLint,
so matchers are relational and multi-language; a runner of its own instead of a
plugin, so there is no synchronous-callback problem to work around; diff-scoped
review; and state arms as an explicit measured axis. Where a measurement here
disagrees with one there, [docs/findings.md](docs/findings.md) says so and says
why.
