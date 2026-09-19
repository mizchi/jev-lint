# Deep dive

Everything measured about jev-lint that is **still true**, organised by topic.

Four other documents, so you can pick the right one:

| | |
| --- | --- |
| [README](../README.md) | how to use it |
| [reference.md](reference.md) | every flag and field, calibration in full, the batching axis, what to expect on real code |
| this file | what is known, and the evidence for it |
| [internal.md](internal.md) | how the code works, for changing it |
| [findings.md](findings.md) | the notebook: how it was learned, in order, including the wrong turns and three retracted claims |

Where this file and `findings.md` disagree, this file is the live one — that is
what it is for. Where a number here has a history, the history is there.

## Re-deriving any of this without spending anything

Every conclusion below rests on a recorded run. Five of the records are run
records, which replay for free with no API key:

```bash
jev-lint replay docs/data/<record>.json --labels corpus/labels.json
```

| record | replays | what it holds |
| --- | --- | --- |
| `calibration.json` | yes | the shipped 15-rule fit, file axis — re-recorded 2026-09-19 14:24 UTC after the `secondary` capture fix, at the refit cutoffs; see the note below |
| `calibration-rule-axis.json` | yes | the naming pack refitted on the rule axis |
| `calibration-rule-axis-comments.json` | yes | the comment pack, likewise |
| `self-lint-before.json` | yes | this repository before the fixes of §6 |
| `self-lint-after.json` | yes | and after them |
| `self-lint-2026-09-20.json` | yes | a later full pass over `src`, `tools`, `test/test.ts`, the one the README's cost table quotes |
| `grouping.json` | no | the file-vs-rule axis comparison, as `tools/grouping.ts` writes it |
| `grouping-refit.json` | no | the same comparison with each axis at its own cutoffs |
| `arms.json` | no | four state arms over the whole corpus, as `tools/arms.ts` writes it |
| `self-lint-cache.json` | no | 737 verdicts from an earlier self-lint, kept as a verdict cache |

The four that do not replay are not run records: the two tool outputs carry
their own shape and the cache carries the older `jev-lint-1` schema. They are
still readable — every number quoted from them below was derived with `node`
over the JSON, and the derivation is in this document rather than hidden in a
script.

A cutoff is a claim about a specific set of answers. Keeping the record is what
makes the claim checkable later, and what stops a recalibration from silently
rewriting history.

**The refit of 2026-09-19.** `--show-subjects`, run on the shipped packs the
first time it existed, showed ast-grep's `secondary` bookkeeping capture
going out to the model as `matcher_captured.secondary` on 62 of the corpus's
276 subjects. Removing it changes the question for those subjects, so the
packs were refit: every `at:` moved by 0.08 or less (`fn-name-promises`
0.76 → 0.83 was the largest, its clean band having risen to 0.75), no
labelled decision changed, 12 rules still reach 1.00/1.00, and repeating the
fit moved it by 0.02 or less. The tables in §2–§6 that quote a cutoff were
made at the earlier values and are left as recorded; the earlier
`calibration.json` is in git history before that date.

## 1. What the model is good at, and what it is not

The division of labour is the whole design: ast-grep decides *which* code is
looked at, a sentence decides *whether* it is a problem.

| | who does it | how it fails |
| --- | --- | --- |
| `rule:` | ast-grep — exact, free, no model | **silently**: a node it misses is never asked about |
| `ask:` | the model, once per matched node | loudly: every answer appears in `jev-lint gaps` |

Measured shape of the model's competence: it is good at code that
**contradicts a contract it declares about itself** — a name against a body, a
comment against the lines under it, a test title against its assertions — and
measurably *poor* at defects requiring knowledge of a specific API's behaviour,
such as that `.sort()` defaults to lexicographic order or that a regex without
`/g` matches once. The second class belongs to compilers, type checkers and
conventional linters, which decide it exactly and for free.

So the scoping rule — never build what an existing tool can decide
mechanically — is not modesty. It is where this works.

## 2. State: the arm is not a quality knob

`tools/arms.ts` runs the whole corpus once per arm. The column that decides
anything is `sep`, the distance between the clean and defective class means: it
says how far apart the arm pushes the classes, independently of where a cutoff
lands.

`var-name-describes-value`, TypeScript, on the enriched corpus:

| arm | precision | recall | separation | separable |
| --- | --- | --- | --- | --- |
| `bare` | 1.00 | 0.67 | 0.58 | **no** |
| `located` | 1.00 | 1.00 | **0.85** | yes |
| `graph` | 1.00 | 0.67 | 0.55 | no |
| `full` | 1.00 | 1.00 | 0.84 | yes |

On `bare` this rule is not separable **at any cutoff**, and the reason is
specific rather than general:

```ts
const timeoutSeconds = 5000;
```

is only wrong if you know 5000 is milliseconds — which is visible where the
binding is *used*, not where it is declared. The question was being asked about
a subject that could not contain its own answer. No threshold repairs that; the
answers all land mid-scale and it looks like a calibration problem.

So the rule for choosing an arm is **not** "more context is better":

> Give the question the least context that still contains the answer.

Which differs per rule, and the corpus shows all three cases:

| rule | evidence lives | arm | why |
| --- | --- | --- | --- |
| the test rules | in the subject | `bare` | the matcher captures the title *and* the body, so the arm adds nothing; `bare` then wins on cache stability, since an unrelated edit in the same file cannot move the verdict |
| `fn-name-promises` | mostly in the subject | `located` | all arms separate; the file widens the class separation 0.70 → 0.83 and the gap 0.27 → 0.50, and a wider gap is a rule whose cutoff matters less |
| `var-name-describes-value` | in the *usage* | `located` | not separable without it |

**One caveat on that first row.** `arms.json` measured the *pre-split* pack:
the rule that scored 1.00/1.00 on all four arms was `test-name-matches-body`,
which no longer exists — it became `test-name-describes-code` and
`test-name-verifies-claim` (§3). Both successors ship on `bare` inheriting that
result, and **neither has been re-measured across arms.** Given that
`test-name-verifies-claim` holds most of the residue in §6, that is a gap worth
closing before trusting its arm.

Two consequences worth holding on to:

- **`graph` is cheap and specific.** It carries path identity, imports and a
  symbol table with call edges, and no source at all, so its cost barely grows
  with file size. It is the only arm that can answer "is this module named for
  what it contains", because a file's text never mentions its own path.
- **`located` makes the whole file part of the question.** That is the cost of
  its accuracy: editing a file can move every verdict in it, and every cached
  verdict for it is invalidated. `bare` is immune to both.

## 3. Calibration

### The gap, not the cutoff

`jev-lint gaps` sorts each rule's answers and reports the largest step between
neighbours, because that step is what a threshold is choosing between:

| verdict | meaning |
| --- | --- |
| `works` | wide gap, cutoff inside it. Any cutoff in the gap gives the same answers. |
| `move` | wide gap, cutoff outside it. The rule discriminates; the threshold is misplaced. |
| `rewrite` | narrow gap. **No cutoff helps.** Check the subject can contain the answer, then rewrite the sentence. |
| `silent` | the matcher never fired. |
| `thin` | under 6 matches. Not a pass. |

How little the exact number matters when the gap is wide: refitting the shipped
rules on a later three-pass run proposed cutoffs up to 0.03 away and **not one
decision changed**. The same effect at larger scale — all 15 rules want a
different cutoff on the rule axis and 12 of them change no decision — is in §4.

### What the corpus numbers are worth

On the 13-file corpus, **12 of the 15 rules reach precision 1.00 and recall
1.00** with no decision flips across passes, and **3 have no separating cutoff
at all**: both `comment-describes-block` rules, which ship saying so, and
`test-name-describes-code-rust`, which sits at precision 0.67. (An earlier
write-up said 13 of 15; recounting from `calibration.json` gives 12, and the
count is reproducible with `jev-lint replay docs/data/calibration.json --labels
corpus/labels.json`.) Read the 12 as "the rules separate the classes in a
corpus I wrote", not as a generalisation, and note the baseline it has to be
read against: on an imbalanced set, **a tool that reports nothing at
all scores 83.0% accuracy** here — 229 of the corpus's 276 subjects are clean —
at zero recall. Accuracy is the wrong number; precision and recall with the raw
tp/fp/fn counts are the honest ones. (An earlier write-up gave 79.9%, which was
107 of 134 on the retired 10-file corpus.)

Cutoffs are **per rule, never shared.** Eight same-shaped questions were
measured returning between 0.20 and 0.94 for their own defect class. The cold
ones were not broken — their ranking was fine — they simply never reached a
common threshold.

### Three traps, all of them hit here

- **An easy corpus hides a hole you cannot see from inside it.** The first
  version of this corpus had clean cases that were all trivially clean, topping
  out at 0.36 against a defect band starting at 0.92. A cutoff of 0.61 looked
  safe by a wide margin — until the first unseen function produced a false
  positive at 0.69. The fix was adding the *hard* clean class: the vague but
  true comment, the conventional counter name, the entry point named for its
  directory.
- **Markers in a corpus contaminate rules that read comments.** `// CLEAN:` and
  `// DEFECT:` annotations sitting above a declaration are doc comments as far
  as the comment rules are concerned. Those rules can only be calibrated on
  files where the marker sits above a *real* doc comment.
- **A wrong domain model looks exactly like a bad question.** Splitting one test
  rule into two made the numbers *worse*, 1.0/1.0 down to 0.5/0.5. The wording
  was not the problem: the two failure modes are **nested, not disjoint** — a
  test that exercises the wrong case also fails to establish its name — so
  subjects belonging to both classes had been labelled as belonging to one.
  Relabelling fixed it. When a split makes things worse, suspect the labels.

### The corpus also kept containing defects nobody planted

Three times a rule flagged something the labels called clean, and three times
the rule was right: `configure`, and `summarize` twice, each of which takes one
argument and returns the sum of several unrelated numbers.

All three were written as *containers* — somewhere to put the declarations the
binding rule judges, summed at the end to stop the compiler complaining about
unused values. The pattern generalises past this corpus, which is why it is
worth naming: **a function written only to hold other code has no job to be
named after, so it cannot be named honestly.** Real codebases produce these
constantly — the `setup`, the `init`, the `handle`, the `process` — and no
compiler will ever object to one.

## 4. The batching axis

The state can be built two ways, and the choice is not free.

- **`--group file`** (default) — one state per file: its source, then every
  match in it. The source is amortised over the matches.
- **`--group rule`** — one state per rule: only what the matcher caught, from
  anywhere. No file is ever sent whole. Note what it does *not* carry: the
  `local` arm attaches a match's enclosing function only when the match is a
  *fragment* inside one, so a rule whose subject is already a whole function
  gets no context and is effectively on `bare`.
- **`--group auto`** — cost both per rule before asking anything, and pick.

### Cost: a round-trip saving, not really a money saving

Planned on real repositories with `--dry-run`, both shipped packs, at the cap
that actually ships (`--rule-batch-cap 32`):

| | file axis | rule axis @32 | |
| --- | --- | --- | --- |
| tokio, 10,886 subjects | 896 req / 5.94M tok | **268 req** / 5.02M tok | 3.3× fewer requests, −15.5% tokens |
| vue, 19,659 subjects | 1,739 req / 15.01M tok | **671 req** / 14.26M tok | 2.6× fewer requests, −5.0% tokens |

**Those are planning numbers only. No accuracy was ever measured on tokio or
vue, and none should be quoted from here**: `tools/grouping.ts` resolves an
unlabeled subject to `clean`, so any precision column it prints for an
unlabeled repository is arithmetic over fabricated labels.

At an uncapped batch of 256 it is 11.2×/−16.2% and 7.8×/−5.7%. Those are the
numbers an earlier write-up quoted, and they describe a configuration nobody
runs. Since the API prices tokens, **the rule axis buys latency and rate-limit
headroom, not money.**

Where the saving actually comes from is not amortisation. On tokio, **batches
holding 1–2 subjects are 50.6% of all requests but only 6.3% of tokens — and
that 6.3% is 81% of the entire token delta.** 495 of those thin batches are
`module-name-describes-contents`, which has `subject: file` and is therefore one
request per file by construction. The rule axis's win is removing thin batches.

The density crossover — where amortising a file over many matches should start
to beat sending only the matches — is real and unreachable. A 14-point
single-rule sweep on tokio and an 8-point one on vue show the token ratio rising
monotonically with density, 0.057 at 1.14 matches per file to 0.998 at 139, but
**the crossover sits at about 135 distinct matches per file**, an order of
magnitude past the densest rule anyone writes. The reason is in this
repository's own code: `buildRuleState` deduplicates shared enclosing
functions, which bounds the rule axis's context cost near the file's own source
instead of letting it grow with density. Before that deduplication existed the
rule axis cost 37% *more* than the file axis on tokio.

One measurement subtlety: density has to be counted after subject-text
deduplication. A `kind: identifier` rule on tokio has a raw density of 193.9 and
a ratio of 0.712, because 73,092 identifiers collapse to 4,699 distinct question
texts.

### Accuracy: the axis moves verdicts, and most of that is the cutoff

Same corpus, same run, 276 subjects, 15 rules, two passes:

| axis | cutoffs | precision | recall | tp/fp/fn |
| --- | --- | --- | --- | --- |
| file | shipped, fitted on this axis | 0.977 | 0.915 | 43/1/4 |
| rule | shipped, fitted on the *file* axis | 0.955 | 0.894 | 42/2/5 |
| file | refit on its own answers | 0.978 | 0.957 | 45/1/2 |
| rule | refit on its own answers | 0.936 | 0.936 | 44/3/3 |

Refitting recovers most of the difference: the rule axis goes from 42/2/5 to
44/3/3, buying back two defects for one false positive. What is left against the
refitted file axis is **one fewer true positive and two more false positives out
of 276** — a real direction on three events, which is not enough to put a ratio
on. The two axes disagree on 1.4% of decisions (4 of 276), mean absolute delta
0.059.

An earlier write-up said the rule axis carried **2.5× the false positives**.
That is retracted: it compared two axes at one axis's cutoffs, which measures
the mismatch and calls it the axis.

Per rule, on each pack's own calibration corpus, refitting changes **4 of 216
decisions**. Three results in that:

1. **Most cutoff movement is midpoint drift.** All 15 rules want a different
   number and 12 change no decision, because a fitted cutoff is the midpoint of
   a wide gap and the midpoint slides for free.
2. **The one large move is real.** `comment-describes-declaration` wants 0.44 on
   the rule axis against 0.83 on the file axis. It is `located` on the file axis
   and `local` on the rule axis: stripped of the file, the same question answers
   the same defects with much lower values, and the file-fitted cutoff misses
   one.
3. **One rule changes class, and no cutoff fixes it.** `fn-name-promises-rust`
   is 6/0/0 with a separating gap on the file axis and 5/0/1 with **no
   separating cutoff** on the rule axis. Losing the file loses the evidence.

### Retracted: it is not anchoring

The first reading blamed anchoring — unrelated snippets sharing one state
pulling each other toward the middle — on 3 flips in 134 corpus subjects at
batch 256. A proper batch-size sweep on both large repositories retracts it:
flips start at batch 4, the smallest batch with any neighbour, and **saturate by
16** instead of growing with batch size; on vue the 3 flips at batch 256 exactly
equal its own pass-to-pass flips at batch 1; and 9 of 10 flips across both
repositories sat within 0.115 of their cutoff, a band holding only 1.9–3.0% of
subjects.

The honest position is that at this sample size neither the effect nor its
absence is established, and the scheduler should rest on the structural argument
instead — which it does: a rule-axis state spans files, so it cannot carry one,
and a rule whose evidence *is* the file loses it.

### What the scheduler actually does on the shipped configuration

Because every calibrated rule pins `axis: file`, **`auto` moves only the two
`comment-describes-block` rules — the two nobody has calibrated.** Meanwhile
`module-name-describes-contents`, whose `graph` arm survives the switch
untouched and which showed the largest per-rule saving on tokio (377 → 4
requests, −52.7% tokens), is pinned shut. That is the safe default working as
designed, and it is also close to a no-op.

## 5. The API's real limits

Measured against `jev-1.13.0`, not read off documentation.

- **Two independent input budgets**: 65,536 tokens for the whole request and
  **32,768 for `state` alone**, and the state's fills first because it carries
  the file. Binary-searching a real state with one question attached puts the
  largest accepted request at 32,978 server-counted tokens, consistent with the
  state ceiling.
- **Question count is not a limit.** Over a thousand questions in one request
  work.
  **255 is the cap on the number of options in a single `choice` question**,
  which this tool never uses — the "256 questions" premise it was designed
  around was simply wrong.
- **`noul` criteria must be nested** under `criteria: {true, false}`. A flat
  `{true, false}` at the top level returns HTTP 200 with the criteria silently
  discarded; the only symptom is a smaller input-token count.
- **`max_tokens_exceeded` is recoverable for a request and not for a state.**
  Halving the question set rescues a request over budget. Every half still
  carries the same state, so a state over budget ends in lost verdicts — which
  makes the token estimator a correctness property, not a cost optimisation.

### Characters per token, by payload shape

One ratio for everything was wrong, and wrong in the direction that loses
verdicts:

| payload shape | measured | a single 3.4 ratio was |
| --- | --- | --- |
| a file's source inside a state | 3.37 chars/token | accurate to 1% |
| per-subject metadata records | 2.18 chars/token | **36% under** |
| a batch's questions record | 3.68–3.85 chars/token | 15–26% over |

Metadata records are small and syntax-dense; a questions record is large and
repetitive, and a tokenizer does far better on the second. **No single pair of
constants fits both**, which is why the estimator charges string values and JSON
syntax separately and the residual error is absorbed by margins rather than
hidden in the ratios.

On top of the payload, the server charges its own scaffolding: about **270
tokens per request plus 13 per question**.

Hence two margins, because the two budgets fail differently:

| budget | margin | why |
| --- | --- | --- |
| state | 1.25× | unrecoverable, and the estimate's worst case (−12%, on a metadata-only state) is here |
| request | 1.1× | recoverable by halving, and the estimate runs 15–26% *over* on the questions that dominate a request |

Putting enough pessimism into the ratios to cover the state instead made
`--dry-run` overstate a real bill by 22%. Split this way it reads about **9%
high** — a bound to budget against, not a quote.

## 6. Accuracy on real code

Both packs over this repository's own TypeScript (`src`, `tools`, `test`,
`corpus/build-labels.ts`): **1,403 subjects, 65 requests, ~1.02M input tokens,
$0.043, 18s of request time, under 5 seconds of wall clock.** Seven of the
fifteen rules fire; the eight Rust-only rules match nothing and say so.

It found **nine real defects in 8,132 lines of TypeScript** and got two of eleven
findings wrong:

| what it caught | how many |
| --- | --- |
| comments that had become false | 2 |
| tests that did not verify the behaviour their own names claimed | 6 |
| bindings named for their input rather than their value | 6 |
| findings read and disagreed with | 2 of 11 |

Two are worth quoting. `formatGithub`'s doc comment opened with "Everything is
emitted as `notice` or `warning`, never `error`" while the first line of its
body passes `error` through — and the rest of the same comment explained how to
opt into that, so the comment contradicted itself. And "a rule's own axis pin is
never overruled" turned out to assert the pin without establishing that the
scheduler wanted the other axis; writing the stronger version **disproved an
assumption in the scheduler's own design notes** (for a rule on a lean arm the
rule axis is always cheaper, so the disagreeing direction is a `file` pin).

Nothing there is what a compiler, a linter or a coverage tool reports. Coverage
called every one of those tests covered.

### Headroom is the number to watch

On unlabeled real code `gaps` is useless — a gap needs two classes, and real
source is 99.8% clean, so it prints `rewrite` for every rule that fires. What
*is* informative is the distance from the highest clean answer to the cutoff.
Over three passes on 1,403 subjects, averaged per subject:

| rule | subjects | median | highest clean | cutoff | headroom | over |
| --- | --- | --- | --- | --- | --- | --- |
| `test-name-describes-code` | 94 | 0.09 | 0.28 | 0.95 | +0.67 | 0 |
| `fn-name-promises` | 151 | 0.13 | 0.49 | 0.76 | +0.27 | 0 |
| `comment-describes-block` | 149 | 0.20 | 0.75 | 0.97 | +0.22 | 0 |
| `comment-describes-declaration` | 95 | 0.14 | 0.62 | 0.83 | +0.21 | 0 |
| `test-name-verifies-claim` | 94 | 0.16 | 0.44 | 0.54 | +0.10 | 1 |
| `module-name-describes-contents` | 19 | 0.18 | 0.55 | 0.62 | +0.07 | 0 |
| `var-name-describes-value` | 801 | 0.10 | 0.55 | 0.61 | **+0.06** | 2 |

The two rules with the least headroom hold the entire residue. That is the
predictive value of the column: a corpus-fitted cutoff sits where the corpus's
clean band ended, and real code's clean band goes higher.

### The residue, and what it is not

Three of 1,403 subjects are over their cutoff on the three-pass mean, and two
of them by less than 0.01: two `var-name-describes-value` hits on test bindings
named for the case under test (`const unpinned = scoreRule(...)`, `const
asViolation = decide(...)`), which is idiomatic in tests and which I read as
wrong, and one `test-name-verifies-claim` hit sitting exactly on its cutoff.

Single passes report a stable 2 findings each; the three-pass mean names 3.
Averaging is therefore not the same as reporting less — two subjects sit within
0.01 of their cutoff from either side. Pass-to-pass spread per subject is a
median of 0.010 and a p90 of 0.050, with a maximum of 0.300, so a decision that
close is not a verdict.

**Part of the earlier residue was a bug in the tool rather than in the rules.**
A subject over 900 characters on an arm carrying no file source was asked about
with no code in the question at all — the `INLINE_LIMIT` comment had always said
the line-range fallback "only works on an arm that carries the source", and
nothing enforced it. That was **111 subjects, 8% of them.** Fixing it dropped
the per-pass residue from 3–4 findings to 2 and took
`test-name-verifies-claim`'s headroom from +0.02 to +0.10. It did **not** rescue
`comment-describes-block`, the rule most affected by it and the one rule that
has never separated on either axis: refitting after the fix still gives
precision 0.67 at best. So the missing code was a real defect and not that
rule's problem.

I looked for a mechanism and **did not find one.** The obvious hypothesis was
that compound or universal test names read as under-verified whatever the body
does. Grouping all 92 `test-name-verifies-claim` subjects measured at the time
by how many claims their name makes refutes it — the means are flat:

| claims in the name | n | mean | median | over 0.54 |
| --- | --- | --- | --- | --- |
| 1 | 39 | 0.232 | 0.193 | 1 |
| 2 | 41 | 0.191 | 0.147 | 1 |
| 3 | 7 | 0.180 | 0.133 | 1 |
| 4 | 5 | 0.228 | 0.167 | 1 |

Universal phrasing (`every`, `all`, `no`, `never`, `any`) shifts the mean but
only in the tail — 0.251 against 0.196, with medians of 0.19 and 0.16, on 23
samples against 69 — which is too thin to call a mechanism. Compound names
appear at both the top and the bottom of the ranking.

So the honest account of what is left is the unglamorous one: cutoffs fitted
where the corpus's clean band ended, against real clean bands that go higher. No
rule-level pattern, and the remedy is the standing one — refit on your own code,
starting with the two rules at the bottom of the headroom table.

### The false negative worth knowing about

The same measurement found the mirror image. Before the fixes above, the highest
`comment-describes-declaration` answer on this repository was **0.76 against a
0.83 cutoff** — a near miss, and a real defect: a doc comment for `decide`
separated from its function by an interface declaration, so it documented
`GateOptions` instead, and its "Returns a finding or null" was false of a
function that never returns null. The cutoff missed it by 0.07. Fixing it is
why that rule's highest clean answer is 0.63 in the table above.

That is the shape of the risk in both directions: a corpus-fitted cutoff has the
clean band it was shown, and real code supplies both harder clean cases *and*
defects quieter than any in the corpus.

### The uncomfortable half

The four worst bugs of that exercise were found by **reading the tool's own
summary lines**, not by any rule it ran:

1. `6 batch(es) fell back from `bare` to `bare`` — not a fallback at all. The
   planner probed the arm against the state for every match in a file at once,
   so a file was degraded for having many *matches* rather than much *source*.
   Fixing it restored `located` for the 222 subjects per run that had been
   judged at `local` (`self-lint-before.json` counts them; the ~1,000 figure an
   earlier write-up gave was the TOTAL on `located` afterwards, not the number
   restored).
2. The accurate planner then lost 100 verdicts to `max_tokens_exceeded`, and the
   reproduction showed the request refused *with a single question attached* —
   so it was the state, which no split can shrink.
3. That sent the estimator to be measured per shape (§5).
4. Which showed the two budgets need two margins (§5).

## 7. What is still not measured

The largest gaps, kept as a list so nothing is quietly assumed:

- **No labeled accuracy measurement on a large repository, on either axis.** All
  precision and recall figures here are the 13-file corpus or the author's
  reading of this repository's findings. `tools/grouping.ts` resolves unlabeled
  subjects to `clean`, so any precision column it prints for an unlabeled
  repository is arithmetic over fabricated labels.
- **No accuracy measurement at the shipped rule-batch cap of 32.** The sweep
  used 1/4/16/64/256.
- **The `local` arm has never been measured** against the others, though the
  rule axis puts every file-bearing rule on it.
- **The arm measurement predates the test-rule split.** `arms.json` covers the
  8 pre-split rules, so `test-name-describes-code` and
  `test-name-verifies-claim` are on `bare` by inheritance from a rule that no
  longer exists.
- **The axis has never been compared with the arm held constant**, so "the axis
  moves verdicts" and "the arm moves verdicts" are not separated.
- **Review mode has been measured only on the file axis** (2 requests,
  $0.00015 on a one-function diff), never on the rule axis, and it is the mode
  to use.
- **A state over budget still loses its verdicts.** The planner avoids that case
  by margin rather than recovering from it. The fix is for the client to step
  the arm down and retry when question-splitting is exhausted, which needs a
  batch to carry enough to rebuild its own state.
- **The `note_on_independence` sentence has never been ablated.**

`findings.md` §12 has the full list with the reasoning for each.
