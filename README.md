# jevlint

A linter whose rules are sentences.

```
corpus/ts/cart.ts
     21  flag       The body of this function does something materially different from what its name promises.
             fn-name-promises  0.95  cutoff 0.76  arm located
     72  flag       This binding's name misdescribes the value it is bound to.
             var-name-describes-value  0.93  cutoff 0.61  arm located

corpus/ts/cart.test.ts
     27  flag       This test would still pass if the behaviour its name claims were broken.
             test-name-verifies-claim  0.93  cutoff 0.54  arm bare

corpus/ts/session_store.ts
     20  flag       The comment above this code claims something that is not true of the code.
             comment-describes-declaration  0.97  cutoff 0.83  arm located

corpus/ts/utils.ts
      1  flag       This module's name does not describe what the module contains.
             module-name-describes-contents  0.86  cutoff 0.62  arm graph

44 finding(s), 276 subject(s), 0 cached
37 request(s), 155,249 input tokens, $0.00652, 6811 ms
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

Rules are read from `./rules` when that directory exists, and otherwise from the
packs inside the installed package — which it says on stdout when it happens,
because their cutoffs were fitted to this package's corpus and not to your code.
`-r/--rules <path>` overrides both and is repeatable.

### From this repository

```bash
npm install
npm run build          # tsc -> dist/, with .d.ts and source maps
npm run ci             # labels + typecheck + 100 tests + build + offline replay
npm test               # no API key needed
```

Source is TypeScript and ships compiled; `docs/internal.md` has the build
contract and the module map.

## Use

```bash
jevlint check src                  # judge whole files
jevlint review --base main         # judge only what the diff touched
jevlint review                     # ...or what is uncommitted, including untracked files

jevlint gaps corpus                # per-rule separation -- on a LABELED corpus
jevlint calibrate corpus --labels corpus/labels.json --repeat 3 --record run.json
jevlint rules                      # what loaded, and every validation error
jevlint replay run.json            # re-score a recorded run under new cutoffs, free
jevlint replay run.json --labels corpus/labels.json   # ...and re-fit them, free

jevlint check src --dry-run        # plan and price it without asking anything
```

**Review mode is the one to reach for in CI.** It scans only the changed files
and keeps only the matches whose subject overlaps a changed line, so a
four-function diff costs about two requests. It is also where the rules earn
their keep: findings concentrate in freshly written code, because old names have
already been argued over.

```bash
jevlint review --base "$GITHUB_BASE_REF" --format github
```

Exit codes: `0` clean, `1` findings, `2` configuration error, `3` requests
failed and nothing was reported.

| flag | |
| --- | --- |
| `-r, --rules <path>` | rule file or directory, repeatable (default `./rules`, else the packaged packs) |
| `-c, --cache <path>` | verdict cache (default `.jevlint-cache.json`; `none` to disable) |
| `--at <rule=n>` | override one cutoff, repeatable |
| `--unsure-below <n>` | confidence under which a finding is worded as a question |
| `--arm <name>` | override every rule's state arm: `bare`, `local`, `located`, `graph`, `full` |
| `--group <how>` | `file` (default), `rule`, `auto` — see [Batching](#batching) |
| `--rule-batch-cap <n>` | subjects per rule-axis request (default 32) |
| `--explain-schedule` | print the axis chosen per rule, and why |
| `--base <ref>` / `--staged` | what `review` diffs against |
| `--repeat <n>` / `--labels <path>` | `calibrate`: re-ask n times, fit against labels |
| `--record <path>` | write a replayable run record — do this for anything you will quote |
| `--force` | ignore cached verdicts |
| `--dry-run` | plan and price without asking anything |
| `--show-missing` | list subjects that got no verdict |
| `--format <fmt>` | `pretty`, `json`, `github` |
| `--concurrency <n>` / `--batch-size <n>` | default 4 and 256 |
| `--model <id>` | Jev model |
| `--quiet` / `--no-color` | |

Environment: `TYPESAFEAI_API_KEY` (required for anything that asks),
`TYPESAFEAI_BASE_URL`, `JEVLINT_AST_GREP`.

Two lines of output are never noise. **`N rules matched nothing`** is the only
place a dead matcher is visible — check it before trusting a clean run; on a
TypeScript-only repository expect 8 of the 15 shipped rules there, because they
are the Rust variants. **`N without a verdict`** means requests failed, and a
run with failures never reads as a clean repository.

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
| `criteria` | `noul` only | `{true: ..., false: ...}`, nested under `criteria` |
| `at` | cutoff | 0–3 for `score`, 0–1 for `noul` |
| `subject` | `node` (default), `enclosing`, `file` | what code is judged |
| `state` | `bare`, `local`, `located` (default), `graph`, `full` | what the model also sees |
| `note` | | context for the model only |
| `axis` | `file` or `rule` | pin the batching axis; the scheduler will not overrule it |
| `severity` | `hint`, `info`, `warning` (default), `error` | `error` fails a build; earn it first |

### `score` or `noul`

Choose by what the answer means, not by preference.

**`score`** for an ordered conclusion — *how badly* this breaks the rule — on a
fixed four-level scale: `not-applicable`, `satisfied`, `arguable`, `violation`.
Level 0 is how the model says "your matcher caught something this rule was not
written about", which is cheaper to read in a report than to prevent by
hand-tightening a matcher. A score also returns a **confidence**, which is what
lets an uncertain verdict be routed to a human instead of dropped.

**`noul`** for an independent predicate — *whether* something holds. Returns a
bare probability and no confidence, and gets its own cutoff. Its `criteria`
**must** be nested under `criteria:`; a flat `{true, false}` returns HTTP 200
with the criteria silently discarded, so the schema rejects it before it can
reach the wire.

Asking an ordered conclusion as a `choice` is the mistake this avoids: the
ordering is thrown away, adjacent levels split the probability mass, and the
result arrives as a low confidence indistinguishable from real uncertainty.

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
| `bare` | the matched code and the file's name | cheapest, and the only arm immune to unrelated edits in the same file |
| `local` | + each match's enclosing function, deduplicated | — |
| `located` | + the whole file source | — |
| `graph` | + path identity, imports, symbol table with call edges; **no source** | small at any file size |
| `full` | source and graph | hits the 32Ki state budget soonest |

**This is not a quality knob.** More context is not better; it is a choice of
which error you would rather have. The rule that works:

> Give the question the least context that still contains the answer.

Measured, and load-bearing: `var-name-describes-value` is **not separable at any
cutoff** on `bare` and fully separable on `located`, because `const
timeoutSeconds = 5000` is only wrong if you know 5000 is milliseconds, and that
is visible where the binding is *used*. So forcing `--arm bare` to save money
destroys the rules the shipped packs were calibrated on. `tools/arms.ts`
measures this per rule — four arms, two passes, about two cents. The full
evidence is in [docs/deepdive.md](docs/deepdive.md#2-state-the-arm-is-not-a-quality-knob).

### Matcher captures are the sharpest state available

A rule that captures `$NAME` and `$TITLE` has told the question exactly which
two things it is comparing, and they reach the model by name. "Does this body do
what `$NAME` promises" is answerable; "is this well named" is not. This is why
the naming pack captures names rather than relying on the model to find the same
pair in the text — and why the comment rules use `follows:` with a pattern,
which propagates its capture into metavariables, so `$DOC` names the claim and
the matched node is the code.

### One sentence, several grammars

`languages: [TypeScript, Tsx]` works when the matcher is valid in both. Rust and
TypeScript spell the same structural idea with different node kinds, and
ast-grep **rejects** a kind absent from the target grammar — and one rejected
rule fails the whole scan — so those need two matchers. Share the sentence with
a YAML anchor rather than copying it, since copies drift and a drifted copy is a
cache that never hits:

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

| verdict | what to do |
| --- | --- |
| `works` | nothing. Any cutoff inside the gap gives the same answers. |
| `move` | set the cutoff to `suggest`. The rule discriminates; the threshold is misplaced. |
| `rewrite` | the answers are not separated. **No cutoff helps.** Rewrite the sentence — and first check it is not asking for something the subject cannot show. |
| `silent` | the matcher never fired. Loosen it; this is the only place that is visible. |
| `thin` | under 6 matches. Not a pass. |

**`gaps` is for a labeled corpus, not for your repository.** A gap needs two
classes and real code is ~99.8% clean, so on real source it prints `rewrite` for
every rule that fires, which means nothing. There, read the per-rule **median**
and the **headroom** — see [What to expect](#what-to-expect).

Then fit against labels:

```bash
jevlint calibrate src --labels labels.json --repeat 3 --record run.json
```

`--repeat` re-asks and reports which subjects changed *decision* between
passes. A rule can have a wobbly score and a perfectly stable decision, if the
wobble happens far from the cutoff — that is the good case. **A decision sitting
inside the wobble band should not be automated; route it to a person.**

Cutoffs are **per rule, never shared**. Same-shaped questions have been measured
answering their own defect class anywhere between 0.20 and 0.94; the quiet ones
are not broken, they simply never reach a common threshold.

Re-gating is free — `jevlint replay` re-scores a recorded run under new cutoffs
with zero requests, and with `--labels` re-fits them too — so record anything
you will quote. A cutoff is a claim about a specific set of answers, and whoever
holds the record can re-derive it without an API key. Without that,
recalibrating silently rewrites history.

### The corpus is the investment

The thresholds shipped in `rules/*.yml` are fitted to `corpus/`, which makes them
an opinion about that corpus and a starting point on your code. Build your own:
label defects as comments next to the code (`// DEFECT (rule-id): reason`) and
let `corpus/build-labels.ts` derive the JSON, so line numbers cannot drift.

And make sure it contains the **hard** clean cases. The first version of this
corpus had clean cases that were all trivially clean, topping out at 0.36
against a defect band starting at 0.92 — which made a cutoff of 0.61 look safe
by a wide margin, until the first unseen function produced a false positive at
0.69. A hole for a class the corpus does not contain is invisible from inside
the corpus, however good the numbers look.

## Batching

The state can be built two ways, and the choice is not free.

- **`--group file`** (default) — one state per file: its source, then every
  match in it. The source is amortised over the matches.
- **`--group rule`** — one state per rule: only what the matcher caught, from
  anywhere. No file is ever sent whole. Note what this does and does not carry:
  the `local` arm attaches a match's enclosing function only when the match is a
  *fragment* inside one, so a rule whose subject is already a whole function
  gets no context at all and is effectively on `bare`.
- **`--group auto`** — cost both per rule before asking anything, and pick.
  `--explain-schedule` prints what it decided and why.

Planned on real repositories with `--dry-run`, both packs, at the shipped cap:
the rule axis is **3.3× fewer requests and 15.5% fewer tokens on tokio**, 2.6×
and 5.0% on vue. Since the API prices tokens, it buys **latency and rate-limit
headroom, not money**.

Three consequences before you switch it on:

1. **It costs a little accuracy.** On the corpus the two axes disagree on 1.4%
   of decisions, and the residue after refitting is one fewer true positive and
   two more false positives out of 276. One rule
   (`fn-name-promises-rust`) has **no separating cutoff at all** on the rule
   axis, because a rule-axis state spans files and so cannot carry one.
2. **A cutoff belongs to an axis.** Switching means re-fitting — `jevlint replay
   <record> --labels <labels>` does that for free — and the rule-axis numbers
   are not shippable today, because a rule carries one `at:`, so they have to be
   passed with `--at`.
3. **It invalidates the whole verdict cache**, since the axis is part of the key.
   That breaks the commit-the-cache workflow below until the next full run.

So the accurate axis is the default, the cheap one is opt-in, and the scheduler
refuses to move a rule on a file-bearing arm. Pin any rule you calibrated with
`axis: file`. Full numbers in
[docs/deepdive.md](docs/deepdive.md#4-the-batching-axis).

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
wrong-case class and only one fires on weak assertions.

**`rules/comments.yml`** — is the comment still true?

| rule | asks |
| --- | --- |
| `comment-describes-declaration` | does the comment above this declaration still hold? |
| `comment-describes-block` | does a comment inside a body describe the lines under it? |

A comment is a claim in the one notation nothing checks. Deliberately *not*
asked: style, redundancy, whether a comment should exist. One axis only — is the
claim false. A vague or redundant comment is not a defect.

Each rule ships in a Rust and an ECMAScript variant sharing one sentence, so
**on a single-language repository about half the pack will report "matched
nothing"**. Of the 15, **12 reach precision 1.00 and recall 1.00 on the corpus**
with no decision flips across passes, and **3 do not separate at any cutoff**:
`test-name-describes-code-rust` (precision 0.67), and both
`comment-describes-block` rules, which **ship saying so** — cutoffs parked above
every observed answer, `severity: info`, and a note recording what was tried.
Read the 12 as "these rules separate the classes in a corpus the author wrote",
against the baseline that **a tool reporting nothing at all scores 79.9%
accuracy on that corpus**, at zero recall.

## What to expect

Run on this repository's own TypeScript — `src`, `tools`, `test` — the shipped
packs are **1,378 subjects, 65 requests, $0.043 and under five seconds** of wall
clock. That is roughly **3 cents per 1,000 subjects**, and `--dry-run` quotes
about 9% high, so treat it as a bound rather than a price.

It found **nine real defects in about 13,000 lines**:

| what it caught | how many |
| --- | --- |
| comments that had become false | 2 |
| tests that did not verify the behaviour their own names claimed | 6 |
| bindings named for their input rather than their value | 6 |

Nothing there is what a compiler, a linter or coverage reports; coverage called
every one of those tests covered. Details, including two worth quoting, are in
[docs/deepdive.md](docs/deepdive.md#6-accuracy-on-real-code).

### Roughly one finding in five was wrong

**Read every finding against the code before believing it.** Of 11 findings in
one round, 9 were real and 2 were not. That is the honest rate on unlabeled
code, and it is the single most important number here: this is a tool for
generating candidates for a human to judge, not verdicts to act on.

When you disagree with a finding it is usually one of three things, and only the
third means the tool is wrong:

1. **The rule is right and the code is wrong** — most often, in this experience.
2. **The rule is right and the *name* is wrong.** A test called "no batch
   exceeds the ceiling" whose body legitimately exempts one-subject batches is
   not a weak test; it is a name that overclaims.
3. **The rule is wrong.** Then add the case to your corpus as a labeled clean
   example and refit. A false positive that is not in the corpus will come back.

### Headroom predicts your next false positive

After fixing the nine, three passes over identical code leave **5 of 1,378
subjects over their cutoff, all within 0.11 of it**. The useful diagnostic is
not the count but the distance from the highest *clean* answer to the cutoff:

| rule | subjects | median | highest clean | cutoff | headroom |
| --- | --- | --- | --- | --- | --- |
| `test-name-describes-code` | 92 | 0.09 | 0.25 | 0.95 | +0.70 |
| `fn-name-promises` | 150 | 0.13 | 0.50 | 0.76 | +0.26 |
| `comment-describes-block` | 138 | 0.24 | 0.76 | 0.97 | +0.21 |
| `comment-describes-declaration` | 95 | 0.14 | 0.63 | 0.83 | +0.20 |
| `module-name-describes-contents` | 19 | 0.19 | 0.56 | 0.62 | +0.06 |
| `test-name-verifies-claim` | 92 | 0.17 | 0.46 | 0.54 | **+0.08** |
| `var-name-describes-value` | 792 | 0.10 | 0.57 | 0.61 | **+0.04** |

The two rules with the least headroom hold the entire residue. That is what a
corpus-fitted cutoff does: it sits where the corpus's clean band ended, and real
code's clean band goes higher.

### The residue flickers, and averaging is the fix

Consecutive passes over identical code report between 2 and 6 findings. Per
subject, pass-to-pass spread is a median of 0.010 and a p90 of 0.050 — but the
maximum is 0.260, which is enough to cross a cutoff. **Average three passes
before deciding anything near a cutoff**; on this repository a single pass
reports 2–6 findings and the three-pass mean reports 5.

Two honest notes about that residue:

- **There is no describable pattern to it.** The obvious hypothesis — that
  compound or universal test names read as under-verified whatever the body does
  — is refuted: grouping all 92 `test-name-verifies-claim` subjects by how many
  claims their name makes gives flat means of 0.18–0.23. The unglamorous
  explanation is the right one: a cutoff of 0.54 fitted where the corpus's clean
  band ended, against a real clean band with a tail to 0.66.
- **It runs in both directions.** The same measurement found a *missed* defect:
  the highest `comment-describes-declaration` answer on this repository was 0.76
  against a 0.83 cutoff, and it was real — a doc comment separated from its
  function by an interface declaration, documenting the wrong thing. The cutoff
  missed it by 0.07.

So: **expect to refit on your own code.** That is not a disclaimer, it is the
documented procedure, and `replay --labels` makes it free once you have a
record.

## How it behaves when things go wrong

A review tool that can break a build is worse than no review tool, so every
failure path lands on "no verdict":

- A failed request, an unusable answer, a missing or corrupt cache: no finding,
  and the count of missing verdicts is reported in every format. **A run with
  failures never reads as a clean repository.**
- A malformed rule is dropped with a reason, printed loudly. A rule that
  silently failed to load looks exactly like a rule that found nothing.
- A file whose **source** is too large for the 32Ki state budget steps down to a
  leaner arm, and says it did. A file with many *matches* is split instead —
  that is not a loss of context and is not reported as one.
- `max_tokens_exceeded` halves the question set and retries. That rescues a
  request over budget and **cannot rescue a state over budget**, since every half
  still carries the same state, so the planner packs to a margin under each
  budget. An over-budget state loses its verdicts, and they are counted.

The verdict cache is **trusted input**: anything that can edit it can silence a
rule or invent a finding. Keep it next to your rule files in review, not in a
build-artifact directory. Commit it and CI lints without an API key and
reviewers see the verdicts you saw; leave it ignored and CI pays for a fresh
pass each run. Changing a **cutoff** invalidates nothing, by design, so
recalibration is free; changing a rule's *sentence*, its arm, or the batching
axis invalidates the verdicts that depended on them.

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
- **The cutoffs are fitted to 13 files.** Version 0.1.0, one recorded corpus.
  Expect to refit; see [What to expect](#what-to-expect).
- **No accuracy was ever measured on a large repository.** The tokio and vue
  figures above are planning cost only. Do not quote precision from them.

## Further reading

| | |
| --- | --- |
| [docs/deepdive.md](docs/deepdive.md) | everything measured that is still true: arms, cutoffs, the batching axis, the API's real limits, accuracy on real code |
| [docs/internal.md](docs/internal.md) | how the code works, for changing it: module map, data flow, invariants, every tunable constant |
| [docs/findings.md](docs/findings.md) | the notebook, in the order it happened, including the wrong turns and four retracted claims |
| [.claude/skills/jevlint](.claude/skills/jevlint/SKILL.md) | the working procedure, as a skill |

## Layout

```
src/            the tool: scan -> state -> questions -> gate -> report
rules/          the shipped packs
corpus/         the labeled corpus the cutoffs are fitted to
tools/          the experiments: arms.ts, grouping.ts
docs/data/      recorded runs, each replayable with no API key
test/test.ts    100 checks, no API key needed
```

`docs/internal.md` has the module-by-module map.

## Prior art

The idea of asking a model a lint question comes from
[mizchi/jev-playground](https://github.com/mizchi/jev-playground)'s
`eslint-plugin-jev`. What is different here: relational multi-language matchers
instead of single-node ESLint selectors, a custom runner instead of ESLint's
synchronous per-file callback, diff-scoped review mode, the state arm as a
measured axis rather than a fixed choice, and record/replay so a threshold is
auditable. The calibration discipline — gap before threshold, per-rule cutoffs,
confidence routes rather than gates — comes from its `docs/practice.md`.

MIT.
