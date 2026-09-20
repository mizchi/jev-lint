# Reference

Everything the [README](../README.md) leaves out: every flag, every rule field,
the calibration procedure in full, the batching axis, and what was measured on
real code. [deepdive.md](deepdive.md) has the evidence behind the numbers;
[internal.md](internal.md) is for changing the code.

## Commands and flags

```bash
jev-lint check src                  # judge whole files
jev-lint review --base main         # judge only what the diff touched
jev-lint review                     # ...or what is uncommitted, including untracked files

jev-lint gaps corpus                # per-rule separation -- on a LABELED corpus
jev-lint calibrate corpus --labels corpus/labels.json --repeat 3 --record run.json
jev-lint rules                      # what loaded, and every validation error
jev-lint replay run.json            # re-score a recorded run under new cutoffs, free
jev-lint replay run.json --labels corpus/labels.json   # ...and re-fit them, free
jev-lint init                       # write a .jev-lint.yaml to start from

jev-lint check src --dry-run        # plan and price it without asking anything
```

**Review mode is the one to reach for in CI.** It scans only the changed files
and keeps only the matches whose subject overlaps a changed line. Measured on a
one-function diff in this repository's corpus: **2 requests, 3,460 input tokens,
$0.00015, 0.6 seconds**, with 3 subjects judged and 28 skipped as outside the
diff. It is also where the rules earn their keep — findings concentrate in
freshly written code, because old names have already been argued over.

```bash
jev-lint review --base "$GITHUB_BASE_REF" --format github
```

Exit codes: `0` clean, `1` findings, `2` configuration error, `3` requests
failed and nothing was reported.

| flag | |
| --- | --- |
| `-R, --rules <path>` | rule file or directory, repeatable (default `./rules`, else the packaged packs) |
| `-r, --retry <n>` | ask everything n times and decide on the mean (default 1) — see [Asking more than once](#asking-more-than-once) |
| `-c, --cache <path>` | verdict cache (default `.jev-lint-cache.json`; `none` to disable) |
| `--at <rule=n>` | override one cutoff, repeatable |
| `--unsure-below <n>` | confidence under which a finding is worded as a question |
| `--arm <name>` | override every rule's state arm: `bare`, `local`, `located`, `graph`, `full` |
| `--group <how>` | `file` (default), `rule`, `auto` — see [Batching](#batching) |
| `--rule-batch-cap <n>` | subjects per rule-axis request (default 32) |
| `--explain-schedule` | print the axis chosen per rule, and why |
| `--base <ref>` / `--staged` | what `review` diffs against: the merge base with `ref`, or the index (what a commit will contain: no untracked files, no unstaged edits) |
| `--fail-on <severity>` | exit 1 only for a finding at or above `hint`, `info`, `warning`, `error`; default: any finding |
| `init --pre-commit` | write a hook running `review --staged --fail-on error`; refuses to overwrite an existing hook without `--force` |
| `eval [dirs...]` | run every `rules/<id>/evals/` suite (`--repeat n`, default 3), score at the shipped cutoff, compare with the baseline; `--accept` makes the run the baseline, `--accept-last` promotes the previous run without asking, `--replay` re-scores every baseline at the current cutoffs with no request and fails on a regression or a changed question |
| `--repeat <n>` / `--labels <path>` | `calibrate`: re-ask n times, fit against labels |
| `--record <path>` | write a replayable run record — do this for anything you will quote |
| `--force` | ignore cached verdicts |
| `--dry-run` | plan and price without asking anything |
| `--show-missing` | list subjects that got no verdict |
| `--show-subjects` | with `--dry-run`: list every subject with its line, node kind and captures |
| `--format <fmt>` | `pretty`, `json`, `github` |
| `--concurrency <n>` / `--batch-size <n>` | default 4 and 256 |
| `--model <id>` | Jev model |
| `--quiet` / `--no-color` | |

| `--config <path>` | config file (default: the nearest `.jev-lint.yaml`, searching upwards); `--no-config` ignores it |
| `--base-url <url>` | the API endpoint, for a proxy or a self-hosted deployment |

Environment: **`TYPESAFE_API_KEY`** (required for anything that asks), with
`TYPESAFEAI_API_KEY` accepted as a fallback; `TYPESAFE_BASE_URL`,
`JEV_LINT_MODEL`, `JEV_LINT_AST_GREP`.

Two lines of output are never noise. **`N rules matched nothing`** is the only
place a dead matcher is visible — check it before trusting a clean run. On a
TypeScript-only repository expect 8 of the 21 shipped rules there: the 7 Rust
variants, plus `comment-describes-declaration-js`, which exists because
JavaScript has no type declarations to match. **`N without a verdict`** means
requests failed, and a run with failures never reads as a clean repository.

### Silencing a finding

```ts
// jev-lint-ignore-next-line
export function summarize(rows: Row[]): Total { … }

// jev-lint-ignore-next-line fn-name-promises, var-name-describes-value
const x = compute();

// jev-lint-ignore-file comment-describes-block
```

`jev-lint-ignore-next-line` covers the line after it; `jev-lint-ignore-file`
covers the file wherever it appears in it. Both take an optional list of rule
ids, comma- or space-separated, and silence every rule when given none. Any
comment syntax works — `//`, `#`, `/* */`, `--`, `<!-- -->` — because the marker
is matched in the file's text rather than its parse tree.

Two things follow from that, and both are deliberate:

- **A marker has to be the first thing on its line**, after whitespace and a
  comment opener. A string containing the same text is not a marker, which is
  what stops a test fixture from silencing the file it is written in.
- **A suppressed subject is never sent**, so a suppression is also the cheapest
  way to quiet a rule. It is therefore reported: every run prints how many
  subjects were skipped and how many files were suppressed whole, for the same
  reason it prints which rules matched nothing. A suppression that names a rule
  id no rule answers to is called out too — a typo there silences nothing while
  looking like it did.

### Asking more than once

```bash
jev-lint check src --retry 3      # or -r 3
```

The answers are not deterministic, and near a cutoff that matters: measured on
this repository, per-subject spread across passes has a median of 0.010 and a
p90 of 0.050, but a maximum of 0.300 — enough to cross one. `--retry n` asks
everything n times, **decides on the mean**, and reports how many passes agreed:

```
     72  flag       This binding's name misdescribes the value it is bound to.
         var-name-describes-value  0.95  cutoff 0.61  arm located  3/3 passes
     88  flag       This test would still pass if the behaviour its name claims were broken.
         test-name-verifies-claim  0.57  cutoff 0.54  arm bare  1/3 passes
         did not reproduce in every pass (spread 0.24) -- decide this one by hand
```

`3/3` and `1/3` are different claims, and the second is the one
[not to automate](#anything-near-a-cutoff-belongs-to-a-human). Note two things:

- **The verdict cache is bypassed above 1.** A cached answer reproduces itself,
  which would measure nothing.
- **Only the asking repeats.** The matcher and the planner run once, so every
  pass sends identical states and question ids — which is what makes the
  answers comparable. It also means n passes cost n times the tokens.

## Rule fields

A jev-lint rule is an ast-grep rule plus `ask:`.

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
- `file` — the module, presented as an **outline**: its path, its public items
  with their signatures, its private items, its imports. A symbol declared
  inside another (a method, a helper closed over by the function that uses
  it) is listed indented under its container, not as a sibling of it. The
  outline is capped at 16,000 characters — every export is kept, the private
  list is cut from the end and says how many it left out — so a module of
  any size gets a verdict. The only way to ask "is this module named for
  what it contains", because a file's text never mentions its own path.

### `state`: what else the model sees

One state per file carries every question for that file, which is the entire
cost argument: the file is sent once and each extra question costs only its own
text.

| arm | carries | cost |
| --- | --- | --- |
| `bare` | the matched code and the file's name | cheapest, and the only arm immune to unrelated edits in the same file |
| `local` | + each match's enclosing function, deduplicated | — |
| `located` | + the whole file source | — |
| `graph` | + path identity, imports, symbol table with each symbol's signature and call edges; **no source** | small at any file size |
| `full` | source and graph | hits the 32Ki state budget soonest |

**This is not a quality knob.** More context is not better; it is a choice of
which error you would rather have. The rule that works:

> Give the question the least context that still contains the answer.

Measured twice, and the second measurement corrects the first. On the
marker-free corpus (`docs/data/arms.json`, 2026-09-20, five arms, two
passes, $0.21) the arm makes a difference a reader can see for **one** rule:
`test-mocks-subject`, whose evidence is a `vi.mock` at the top of the file,
loses recall on `bare` (0.8) and `graph` (0.6) and separates on `located`.
For every other rule the five arms land within 0.05 of each other in class
separation, and the declared arm is within noise of the best. The earlier
story — that `var-name-describes-value` needed the file because `const
timeoutSeconds = 5000` is only wrong where the binding is used — was the
corpus marker talking: with it gone that case answers 0.22 at every arm, and
the rule does not separate at any. So the choice of arm is not a quality
knob, and it is also, on this evidence, rarely a separation knob: pick the
cheapest arm whose state holds the evidence, and measure when the evidence
lives outside the node. The evidence and the numbers are in
[docs/deepdive.md](deepdive.md#2-state-the-arm-is-not-a-quality-knob).

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

**Read the gap before you touch a threshold.** `jev-lint gaps` sorts each rule's
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
jev-lint calibrate src --labels labels.json --repeat 3 --record run.json
```

`--repeat` re-asks and reports which subjects changed *decision* between
passes. A rule can have a wobbly score and a perfectly stable decision, if the
wobble happens far from the cutoff — that is the good case. **A decision sitting
inside the wobble band should not be automated; route it to a person.**

Cutoffs are **per rule, never shared**. Same-shaped questions have been measured
answering their own defect class anywhere between 0.20 and 0.94; the quiet ones
are not broken, they simply never reach a common threshold.

Re-gating is free — `jev-lint replay` re-scores a recorded run under new cutoffs
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
2. **A cutoff belongs to an axis.** Switching means re-fitting — `jev-lint replay
   <record> --labels <labels>` does that for free — and the rule-axis numbers
   are not shippable today, because a rule carries one `at:`, so they have to be
   passed with `--at`.
3. **It invalidates the whole verdict cache**, since the axis is part of the key.
   That breaks the commit-the-cache workflow below until the next full run.

So the accurate axis is the default, the cheap one is opt-in, and the scheduler
refuses to move a rule on a file-bearing arm. Pin any rule you calibrated with
`axis: file`. Full numbers in
[docs/deepdive.md](deepdive.md#4-the-batching-axis).

## The shipped packs

23 rules, one directory each under `rules/` with its evals beside it,
grouped here by what they ask. The naming and comment rules carry an
ECMAScript and a Rust variant sharing one sentence; the rest are ECMAScript
or JSON only. The notes the former packs shipped with are in
`rules/README.md`.

**Naming** — does the code do what it calls itself?

| rule | asks |
| --- | --- |
| `fn-name-promises` | does this function's body do what its name promises? |
| `var-name-describes-value` | does this binding's name describe the value bound to it? |
| `test-name-describes-code` | does this test's code do what its name says? |
| `test-name-verifies-claim` | would it still pass if the named behaviour broke? |
| `module-name-describes-contents` | is this module named for what it contains? |
| `module-naming-consistent` | do this module's exports name the same kind of operation with the same words? |

`module-naming-consistent` is the one rule that reads a convention off the
file instead of being told it: the outline carries every export's signature,
so four synonyms for one lookup are visible in one state, and a sync `get`
beside an async `fetch` is not a mismatch because the signatures say why.
It ships at `severity: info`. Its sibling `sibling-deviates` — one export
breaks a pattern the rest follow — separates only as a `score` and only for
signature-level deviations, and stays in `experiments/reports/e-file-consistency/`.

The two test rules are **nested, not orthogonal** — a test that exercises the
wrong case also fails to establish its name — which is why both fire on the
wrong-case class and only one fires on weak assertions.

**Comments** — is the comment still true?

| rule | asks |
| --- | --- |
| `comment-describes-declaration` | does the comment above this declaration still hold? |
| `comment-describes-block` | does a comment inside a body describe the lines under it? |

A comment is a claim in the one notation nothing checks. Deliberately *not*
asked: style, redundancy, whether a comment should exist. One axis only — is the
claim false. A vague or redundant comment is not a defect.

**Guarantees** — a name that makes a specific promise

| rule | names | asks |
| --- | --- | --- |
| `safe-name-is-safe` | `safe*`, `try*`, `*OrNull`, `*OrDefault`, `*OrUndefined` | does a failure of the kind the name absorbs still escape as a throw or rejection? |
| `idempotent-name` | `ensure*`, `upsert*`, `setup*`, `install*`, `register*` | does a second call leave a different result from the first? |
| `pure-name-is-pure` | `compute*`, `calculate*`, `derive*`, `format*`, `to*`, `parse*` | does the body reach outside itself: mutate an argument, write its own result into a cache that outlives the call, read the clock, the environment or a random source, even only on a fallback path? |

These are narrower cousins of `fn-name-promises`, and the narrowing is the
point: on the corpus behind this pack, `fn-name-promises` at its cutoff flags
0 of the 22 labelled defects, 16 of which sit under 0.30 inside its clean
band.

`pure-name-is-pure` is the one that needed a second revision. Its first
counted a lazily loaded wasm module as I/O and was wrong on all six of its
findings on an unseen repository. The criteria now separate acquiring a
dependency (not an effect) from caching the function's own result (an
effect), and say one read on any path is enough; on the same repository the
revision found six impurities, all real — `parse*` functions defaulting a
field to `new Date()`, `process.env` or `randomUUID()`. It ships at
`severity: info` because its unseen clean band tops 0.05 under the cutoff.
The family also built `guard-name-guards` (`validate*`/`sanitize*`), which
separates on four defects and is not shipped on that count. Reports in
`experiments/reports/b-guarantee-names/`.

**Tests** — tests that cannot verify their name, by construction

| rule | asks |
| --- | --- |
| `test-mocks-subject` | is the behaviour the title claims performed by a stub, with the assertion reading the stub's canned value back? |
| `snapshot-only-behaviour-claim` | does the title claim a property (an ordering, a hidden row, a branch) that a whole-render snapshot does not isolate? |

Both need `state: located`: a `vi.mock` at the top of the file is what makes
the first answerable, and on `bare` its two top-of-file cases fall from 0.6 to
0.3. `test-mocks-subject`'s cutoff is 0.30, low because its defect band is
quiet (0.42–0.64): a mocked subject reads as a mild claim. A third candidate,
`test-asserts-on-mock`, separated as well and was dropped because
`test-name-verifies-claim` already reports every one of its cases.

**Messages** — messages for a human reader

| rule | asks |
| --- | --- |
| `log-level-matches-event` | does the level of this `logger.<level>(...)` call match the severity of the code path it sits on? |

Siblings not shipped, in `experiments/reports/c-human-messages/`:
`assertion-message-matches` — its first revision's four unseen findings were
all test stubs throwing a simulated failure on a call counter; the second
keeps those out by matcher and by criteria and produces zero unseen
findings, but sits 0.06 over a nested-guard clean that flips one pass in
three, so it stays a recipe — and `ui-message-honest` (needs `subject:
enclosing`; measured before the promoted-subject key was fixed, so worth
re-measuring).

**Config** — names in configuration files

| rule | asks |
| --- | --- |
| `script-name-does` | does this `package.json` script's name describe the command it runs? |

The matcher is the whole `"name": "command"` pair under `scripts`, so the
claim and the evidence are one node and `bare` is the arm. Siblings not
shipped: `workflow-step-name` (GitHub Actions `name:` versus `run:`, separates
by one subject's width) and `openapi-summary-matches-schema` (no unseen code
to meet); both in `experiments/reports/a-config-names/`, with nine
things about matching YAML and JSON in ast-grep that the skill now states.

### What the cutoffs are worth

On a TypeScript-only repository the seven Rust variants and
`comment-describes-declaration-js` report "matched nothing": 8 of the 23.

Of the 23, **20 reach precision 1.00 and recall 1.00 at their shipped cutoffs
on their own evals** (`rules/*/evals/baseline.json`, three passes each,
decisions on the mean; `jev-lint eval --replay` re-derives every number below
with no request). Read that with the positive counts beside them: per rule,
31, 17, 13, 12, 12, 11, 10, 10, 10, 10, 9, 9, 6, 6, 6, 5, 5, 5, 4, 4, 2, 2, 1
labelled defects — 200 in all, against 113 before the improvement round of
2026-09-20, in which six agents each took one or two rules, added hard cases
drawn from real code, and rewrote criteria until the rule separated or the
reason it could not was named. The two `module-name-describes-contents`
rules still have one defect each and ship at `severity: info`;
`comment-describes-declaration-js` has two.

Three do not, each by one labelled defect the rule file names:

| rule | at the shipped cutoff | the one it misses |
| --- | --- | --- |
| `var-name-describes-value` | recall 0.92 | `flat = normalizeRule(bad)` holding a rejection: the claim is about the branch of a union result, visible only in the assertions after it |
| `var-name-describes-value-rust` | recall 0.90 | a field taken under another field's name, answering 0.10–0.87 on identical input across runs |
| `comment-describes-block` | recall 0.92 | a comment true of the sort it sits above and false only together with the loop after it (0.52); parked at 0.75 over the band that big test files still produce, since the arm steps down to `local` there and a test callback has no container to promote to |

What the round moved, besides the counts: `fn-name-promises` from 0.82 to
0.55 — the old cutoff had been fitted to outrageous defects only, and the
real ones added from a worker and a queue landed at 0.50–0.74 under it;
`test-name-describes-code` from an "inversion" no cutoff repaired to
1.00/1.00, because the inverted case was a label error (a test whose body
calls no sort is not "about the right thing weakly", it is about something
the code never touches); `comment-describes-block` from recall 0.5 to 0.92
once its root cause was found — a statement inside a `test(...)` callback
has no named container, so `subject: enclosing` could not promote it and
the model was judging one line and its comment; and every rule's clean band
has hard cases in it that the first corpus did not have.

**The corpus is marker-free, and was not.** Until 2026-09-20 every labelled
defect in the original thirteen files sat under a comment of the form
`// DEFECT (rule-id): named seconds, holds milliseconds`, from which
`corpus/labels.json` was generated. Those lines were inside the files the
`located` arm sends, and for a `subject: enclosing` rule inside the subject.
Stripping them (the labels now live in `corpus/labels.hand.json`) moved the
fits: `comment-describes-declaration` from 0.74 to 0.54, `comment-describes-block`
from a clean 1.00/1.00 to one defect under the real-code clean band,
`var-name-describes-value` from 1.00/1.00 to recall 0.67. The four packs built
later were marker-free from the start, by a brief that said so, and did not
move. The count above is the count after.

`test-name-verifies-claim` briefly joined it. On its original four defects
the rule separated at 0.53 with room to spare; the tests pack added eleven
defects and three hard cleans whose titles claim nothing ("matches the
snapshot", "renders") over a snapshot assertion, and the rule read those at
0.69–0.77, inside its defect band: precision 0.93 at any cutoff. The fix was
in the criteria, not the cutoff. Telling the false branch that a snapshot
establishes a snapshot claim, and a call assertion an interaction claim, put
the three cleans at 0.40 and under and the fourteen defects at 0.53 and
over. It ships at 0.52.

Two rules that did not separate before do now. `comment-describes-block` and
its Rust twin shipped "NOT CALIBRATED" because a clean case tied a defect in
the same function at 0.94. It was not the rule: a `subject: enclosing` rule
keyed its verdicts on the enclosing function, so two matches in one function
got one answer. With the match in the key both variants reach 1.00/1.00, on
two defects each, at `severity: info` until the corpus has more.

The cutoffs were refit twice on 2026-09-19: once after a fix to what the
model is shown (an ast-grep bookkeeping capture had been going out beside the
real ones on a quarter of the subjects), once after the promoted-subject fix
and the merge of the four new packs' corpora. Between the two, `fn-name-promises`
moved 0.76 → 0.86 as its clean band rose with 45 more named functions in the
corpus, and no other shipped rule moved by more than 0.08. The measurements
below that quote a cutoff were made at the earlier values, and say which.
Read the 17 as "these rules separate the classes in a corpus the author and
five agents wrote", against the baseline that **a tool reporting nothing at
all scores about 89% accuracy on that corpus** — most of its 988 subjects are
clean — at zero recall.
Accuracy is the wrong number on a set that imbalanced; the precision and recall
pair with the raw counts is the honest one.

## What to expect

The figures in this section are from `docs/data/self-lint-after.json`,
recorded 2026-09-19 12:34 at the cutoffs shipped then; the [README's cost
table](../README.md#what-a-full-run-costs) has a later full pass, and the
current cutoffs are in `rules/`. Run on this repository's own TypeScript —
`src`, `tools`, `test` — the shipped packs were **1,403 subjects, 67
requests, 1.12M input tokens, $0.047 and under five seconds** of wall clock.
That is roughly **3 cents per 1,000 subjects**, and `--dry-run` quotes about
9% high, so treat it as a bound rather than a price.

Over several rounds it found, in 8,132 lines of TypeScript, **22 sites worth
changing**:

| what it caught | sites |
| --- | --- |
| comments that had become false | 3 |
| tests that did not verify the behaviour their own names claimed | 7 |
| bindings named for their input rather than their value | 12 |

Those are individual sites, not independent discoveries — the twelve bindings
are one defect made twelve times, and a single round's findings were 11, of
which 9 were real. Nothing there is what a compiler, a linter or coverage
reports; coverage called every one of those tests covered. Details, including
two worth quoting, are in
[docs/deepdive.md](deepdive.md#6-accuracy-on-real-code).

### About one finding in five was wrong

**Read every finding against the code before believing it.** In one round, 11
findings were reported and I judged 9 real and 2 wrong.

Three caveats on that number, because it is the most quotable one here and the
weakest: it is **one round**, on **one repository**, judged by the person who
wrote both the rules and the code. It is a self-assessment, not a measurement
against labels — the only labelled accuracy figures anywhere in this project are
the corpus ones above. Treat it as an order of magnitude and nothing finer.

What it is enough to establish is the posture: **this generates candidates for a
human to judge, not verdicts to act on.**

When you disagree with a finding it is usually one of three things, and only the
third means the tool is wrong:

1. **The rule is right and the code is wrong** — most often, in this experience.
2. **The rule is right and the *name* is wrong.** A test called "no batch
   exceeds the ceiling" whose body legitimately exempts one-subject batches is
   not a weak test; it is a name that overclaims.
3. **The rule is wrong.** Then add the case to your corpus as a labeled clean
   example and refit. A false positive that is not in the corpus will come back.

### Headroom predicts your next false positive

After fixing the nine, three passes over identical code report **2 findings
each**, and the three-pass mean leaves **3 of 1,403 subjects** over their
cutoff — two of them by less than 0.01. The useful diagnostic is not that count
but the distance from the highest *clean* answer to the cutoff:

| rule | subjects | median | highest clean | cutoff | headroom |
| --- | --- | --- | --- | --- | --- |
| `test-name-describes-code` | 94 | 0.09 | 0.28 | 0.95 | +0.67 |
| `fn-name-promises` | 151 | 0.13 | 0.49 | 0.76 | +0.27 |
| `comment-describes-block` | 149 | 0.20 | 0.75 | 0.97 | +0.22 |
| `comment-describes-declaration` | 95 | 0.14 | 0.62 | 0.83 | +0.21 |
| `test-name-verifies-claim` | 94 | 0.16 | 0.44 | 0.54 | +0.10 |
| `module-name-describes-contents` | 19 | 0.18 | 0.55 | 0.62 | +0.07 |
| `var-name-describes-value` | 801 | 0.10 | 0.55 | 0.61 | **+0.06** |

`jev-lint` prints those two columns itself, and the table above is one free
command — no API key, the three recorded passes averaged:

```bash
jev-lint replay docs/data/self-lint-after.json
```

The two rules at the bottom of the table hold the entire residue. That is what a
corpus-fitted cutoff does: it sits where the corpus's clean band ended, and real
code's clean band goes higher. Those two are the rules to refit first on your
own code.

### Anything near a cutoff belongs to a human

Per subject, pass-to-pass spread is a median of 0.010 and a p90 of 0.050 — but
the maximum is 0.300, which is enough to cross a cutoff. So **average three
passes before deciding anything near a cutoff**, and note that averaging is not
the same as reporting less: here the per-pass count is a stable 2 while the
three-pass mean names 3, because two subjects sit within 0.01 of their cutoff
from either side. A decision that close is not a verdict; route it to a
person.

Two honest notes about that residue:

- **Some of it was a bug in this tool, not in the rules — and I published "no
  describable pattern" before finding it.** A subject over 900 characters on an
  arm that carries no file source was asked about with **no code in the question
  at all**: 111 of this repository's subjects, 8% of them, concentrated in
  exactly the long test bodies the residue consisted of. Fixing it dropped the
  per-pass residue from 3–4 findings to a stable 2 and tripled
  `test-name-verifies-claim`'s headroom. It did *not* rescue
  `comment-describes-block`, the rule most affected, which still does not
  separate. So the first explanation of a residue is worth distrusting,
  including this one.
- **What is left has no pattern I can name.** The obvious hypothesis — that
  compound or universal test names read as under-verified whatever the body does
  — is refuted: grouping all 94 `test-name-verifies-claim` subjects by how many
  claims their name makes gives flat means of 0.18–0.23. The unglamorous
  explanation is the one that fits: a cutoff fitted where the corpus's clean
  band ended, against a real clean band that goes higher.
- **It runs in both directions.** Before those fixes the highest
  `comment-describes-declaration` answer here was 0.76 against a 0.83 cutoff —
  a **missed** defect, and a real one: a doc comment separated from its function
  by an interface declaration, so it documented the wrong thing and claimed a
  null return the function never makes. The cutoff missed it by 0.07. Fixing it
  is why that rule's highest clean answer is 0.63 in the table above.

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
recalibration is free; changing a rule's *sentence*, its matcher, its arm, or
the batching axis invalidates the verdicts that depended on them.

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
- **The cutoffs are fitted to small evals.** 78 case files, 200 labelled
  defects across 23 rules, one to thirty-one per rule. Expect to refit; see
  [What to expect](#what-to-expect).
- **No accuracy was ever measured on a large repository.** The tokio and vue
  figures above are planning cost only. Do not quote precision from them.

## Layout

```
src/            the tool: scan -> state -> questions -> gate -> report
rules/          the shipped packs
corpus/         the labeled corpus the cutoffs are fitted to
tools/          the experiments: arms.ts, grouping.ts
docs/data/      recorded runs, each replayable with no API key
test/test.ts    the suite, no API key needed
```

`docs/internal.md` has the module-by-module map.

