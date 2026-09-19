# Findings

Everything measured while building this, in the order it happened, including
the parts that went wrong and the parts that were later retracted. Against
`jev-1.13.0`.

**Read in order, and note that later sections supersede earlier ones where they
conflict.** Sections 1-8 record the tool at 8 rules over a 10-file corpus, with
`.mjs` sources and a single batching axis. Sections 9-11 are the current state:
15 rules across three packs, a 13-file corpus, TypeScript sources, and two
batching axes. Section 12 lists what is still unmeasured, and section 13 is the
tool applied to its own source, which is where its four worst bugs were found.
Where a number changed, the later one is the live one and the earlier one is
left standing because how it changed is part of the evidence. Four claims are
explicitly **retracted**, and every one of them is section 9 retracting its own
earlier wording: the "2.5x the false positives" figure, anchoring as the
explanation for batch flips, the "14.6x fewer requests" scale figures, and the
description of what the `local` arm substitutes. They are marked in place
rather than deleted. Section 12 then walks the anchoring retraction partly
back, on the grounds that it claims more power than its sample size has.

Re-derive the tables without spending anything:

```bash
npm run replay        # re-score AND re-fit the recorded run, no API key
npm test              # 99 checks, no API key
npm run typecheck     # the full type surface, including tools and tests
```

The recorded runs, each replayable with `jevlint replay <path> --labels
corpus/labels.json`:

| record | what it holds |
| --- | --- |
| `calibration.json` | the shipped 15-rule fit, file axis (sections 1, 4, 10) |
| `calibration-rule-axis.json` | the naming pack refitted on the rule axis (section 9) |
| `calibration-rule-axis-comments.json` | the comment pack, likewise |
| `grouping.json` | the axis comparison (section 9) |
| `grouping-refit.json` | the same comparison with each axis at its own cutoffs |
| `arms.json` | four state arms (section 3) |
| `self-lint-before.json` / `self-lint-after.json` | this repository judged before and after section 13's fixes |
| `self-lint-cache.json` | the 737 verdicts behind section 5, kept as a cache |

---

## 1. The headline (superseded by section 9 for the axis; cutoffs refitted since)

Eight rules over two languages, fitted to the 10-file corpus. The rule names
`test-name-matches-body*` were later split into `test-name-describes-code*` and
`test-name-verifies-claim*` (section 10), and every cutoff below was refitted
once the corpus grew to 13 files and the file axis became explicit. The shape of
the result held, though the count did not: recounting the current run gives
12 of 15 rules at precision 1.0 and recall 1.0, with 3 not separating at all.

| rule | language | cutoff | precision | recall | clean band | defect band |
| --- | --- | --- | --- | --- | --- | --- |
| `fn-name-promises` | TS | 0.67 | 1.00 | 1.00 | 0.04–0.36 | 0.92–0.97 |
| `fn-name-promises-rust` | Rust | 0.58 | 1.00 | 1.00 | 0.03–0.27 | 0.89–0.96 |
| `var-name-describes-value` | TS | 0.59 | 1.00 | 1.00 | 0.04–0.23 | 0.94–0.96 |
| `var-name-describes-value-rust` | Rust | 0.62 | 1.00 | 1.00 | 0.04–0.28 | 0.93–0.97 |
| `test-name-matches-body` | TS | 0.69 | 1.00 | 1.00 | 0.10–0.48 | 0.95–0.96 |
| `test-name-matches-body-rust` | Rust | 0.51 | 1.00 | 1.00 | 0.07–0.22 | 0.84–0.97 |
| `module-name-describes-contents` | TS | 0.59 | 1.00 | 1.00 | 0.07–0.34 | 0.84 |
| `module-name-describes-contents-rust` | Rust | 0.48 | 1.00 | 1.00 | 0.07–0.20 | 0.76 |

Across three passes at these cutoffs, **no decision changed**. Mean answer
movement between passes is 0.01–0.02; the largest single subject's movement is
0.15, and it was nowhere near its cutoff.

The cutoffs above are what is shipped. Re-fitting on a later three-pass run
proposed numbers up to 0.03 away from them (`fn-name-promises` 0.66 against
0.67, `var-name-describes-value` 0.62 against 0.59) and **not one decision
differed**. That is the argument of section 4 in miniature: when the gap is
wide, the exact number is not the interesting quantity.

Cost, whole corpus, all eight rules: **24 requests, 77k input tokens,
$0.0032, 4.3 seconds** wall clock at concurrency 4. Review mode on a
four-function diff: **2 requests, $0.00013, 0.7 seconds**.

Aggregated over all eight rules and all 134 subjects: **27 true positives, 0
false positives, 0 misses, 107 true negatives.**

With the baseline stated, because on an imbalanced set it has to be: a tool that
**reports nothing at all** scores 79.9% accuracy on this corpus, at zero recall.
Accuracy is the wrong number here; the pair above is the honest one.

Read the precision and recall figures as "the rules separate the classes in a
corpus I wrote", not as a generalisation. Section 5 is what happened on code
nobody planted.

---

## 2. The corpus kept containing defects I had not planted

Three times, a rule flagged something my own labels called clean, and three
times the rule was right.

| what | scored | what it was |
| --- | --- | --- |
| `configure` (cart.ts) | 0.83 | takes a cart, returns the sum of five unrelated numbers |
| `summarize` (session.ts) | 0.81 | takes a session, returns an arbitrary sum |
| `summarize` (backoff.rs) | 0.79 | same |

All three were written as *containers*: I needed somewhere to put the variable
declarations the binding rule judges, so I wrote a function, put them in it,
and summed them to stop the compiler complaining about unused values.

The pattern is worth naming, because it generalises past this corpus: **a
function written only to hold other code has no job to be named after, so it
cannot be named honestly.** That is exactly the defect the rule looks for. Real
codebases produce these constantly — the `setup`, the `init`, the `handle`, the
`process` — and no compiler will ever object to one.

I relabelled all three as defects. That deserves suspicion, because relabelling
a corpus to agree with a model is how a corpus stops being evidence, so the
justification has to stand without the model: a reader of `summarize(session):
number` learns nothing true about the body. It does. The correction also moved
the numbers a long way, which is the honest cost of having had them wrong — see
section 4.

---

## 3. State: the arm is not a quality knob

`tools/arms.ts` runs the whole corpus once per state arm. The column that
matters is `sep`, the distance between the clean and defective class means: it
says how far apart the arm pushes the two classes, independently of where any
cutoff lands.

**`var-name-describes-value`, TypeScript.** The measurement that drove the
decision, on the original corpus:

| arm | precision | recall | separation | separable |
| --- | --- | --- | --- | --- |
| `bare` | 0.75 | 1.00 | 0.54 | **no** |
| `located` | 1.00 | 1.00 | **0.87** | yes |
| `graph` | 1.00 | 0.67 | 0.50 | no |
| `full` | 1.00 | 1.00 | 0.87 | yes |

Re-run on the enriched corpus, `bare` fails differently — it now loses a defect
rather than gaining a false positive — and reaches the same conclusion:

| arm | precision | recall | separation | separable |
| --- | --- | --- | --- | --- |
| `bare` | 1.00 | 0.67 | 0.58 | **no** |
| `located` | 1.00 | 1.00 | **0.85** | yes |
| `graph` | 1.00 | 0.67 | 0.55 | no |
| `full` | 1.00 | 1.00 | 0.84 | yes |

On `bare` this rule is **not separable at any cutoff**, and the reason is
specific rather than general. The subject is the declaration alone, and

```ts
const timeoutSeconds = 5000;
```

is only wrong if you know 5000 is milliseconds — which is visible where the
binding is *used*, not where it is declared. The question was being asked about
a subject that could not contain its own answer. No threshold repairs that; the
answers all land mid-scale and it looks like a calibration problem.

So the rule for choosing an arm is **not "more context is better"**. It is:

> Give the question the least context that still contains the answer.

Which differs per rule, and the corpus shows all three cases:

| rule | evidence lives | arm | why |
| --- | --- | --- | --- |
| `test-name-matches-body` | in the subject | `bare` | the matcher captures the title AND the body; every arm scores 1.00/1.00, so `bare` wins on cache stability — an unrelated edit in the same file cannot change this verdict |
| `fn-name-promises` | mostly in the subject | `located` | all arms separate perfectly; the file widens the margin 0.65 → 0.81, and a wider margin is a rule whose cutoff matters less |
| `var-name-describes-value` | in the *usage* | `located` | not separable without it |
| `module-name-describes-contents` | nowhere local | `graph` | a file's text never mentions its own path |

### This contradicted a published measurement, and the difference is the question

The `eslint-plugin-jev` experiment measured that adding the surrounding file to
a per-function review verdict cut false positives to a fifth **and increased
misses** — context makes a verdict milder. That did not reproduce here. Adding
the file moved `var-name-describes-value`'s clean mean *down* (0.18 → 0.09) and
its defect mean *up* (0.72 → 0.96): fewer false positives **and** fewer misses.

The difference looks like the question, not the model. "How hard would a
reviewer push back" is a judgment that surrounding context can dilute — more
context, more mitigating circumstances. "Does this name describe this body" is a
judgment that surrounding context supplies *evidence* for. Milder is the wrong
prediction when the extra tokens contain the answer.

Practical consequence: **do not port an arm choice between rules.** Measure it.

### The `graph` arm is cheap and specific

`graph` carries the module's path, imports and symbol table with call edges,
but not the file's text. It is the only arm that can answer a question about a
name's relationship to its surroundings, and it stays a few hundred tokens
whatever the file's size — which matters because the state budget is 32Ki
tokens and a 2300-line file exhausts it on its own. `module-name-describes-
contents` uses it for robustness rather than for the corpus score: `located`
scored marginally better here, but would silently degrade on a large file.

Note also that `graph` *hurt* the binding rule (recall 0.67): a symbol table is
not a substitute for the source when the judgment is local.

### Mixed arms cost requests

Forcing one arm for every rule: **11 requests**, one per file. Letting each
rule use its own: **24 requests**. The state is per (file, arm), so a file needs
one request per distinct arm its rules ask for -- roughly double the round trips
for roughly the same token count. If latency matters more than margin,
`--arm located` collapses them back to one request per file.

Four arms over the corpus, two passes each, costs **$0.023** in total. That is
the price of measuring this instead of guessing it.

---

## 4. Calibration: read the gap, and beware an easy corpus

`jevlint gaps` sorts each rule's answers and reports the largest step between
neighbours. That number, not the cutoff, is what says whether calibration can
help at all:

- **wide gap** — the sentence discriminates. Any cutoff inside the gap gives
  the same answers, so there is nothing to tune.
- **narrow gap** — the answers are not separated. No cutoff helps; the
  *sentence* needs rewriting, and the first thing to check is whether it asks
  for something the subject cannot show.

The binding rule on `bare` was the narrow case, twice over: gap 0.23 on the
Rust variant, and it was also the only rule whose decision flipped between two
passes (0.29 → 0.51 across a 0.50 cutoff). Moving it to `located` fixed the
separability and the flip together. Nothing about the threshold was touched.

### The cutoff moved three times, and only one move was about the model

| corpus state | `fn-name-promises` fits at | why it moved |
| --- | --- | --- |
| original 8 files | 0.61 | clean cases all *trivially* clean, topping out at 0.36 |
| + hard clean cases | 0.87 | `summarize` mislabelled clean at 0.81 dragged the clean band up |
| + labels corrected | **0.67** | `summarize` is a defect; the real clean band tops at 0.36 |

The first number was the dangerous one. A gap of 0.56 between a clean band
ending at 0.36 and a defect band starting at 0.92 makes a cutoff at 0.61 look
safe by a wide margin — and the very first function outside the corpus that
this pack ever judged, a perfectly well-named `isDeliverableToday`, came back at
**0.69**. A false positive on the first unseen input.

The cutoff was not the problem. **The corpus was missing an entire class:
names that are defensible rather than obvious.** A hole for a class the corpus
does not contain is invisible from inside the corpus, however good the numbers
look. `corpus/ts/session.ts` and `corpus/rust/backoff.rs` exist to fill it —
predicates that need an inference to verify, mutations whose names announce
them, parses that can fail, `get`s that compute — and `isDeliverableToday`
itself is now in `corpus/ts/shipping.ts` permanently.

### What transfers

Not the numbers. The procedure:

1. Write the sentence. Run `jevlint gaps`. If the gap is narrow, rewrite the
   sentence; do not touch a threshold.
2. Check the question can see its own answer from the subject. If it cannot,
   change the arm or the subject, not the cutoff.
3. Label a corpus, and make sure it contains the *hard* clean cases, not only
   the obvious ones. This is the step that actually decides the cutoff.
4. Fit with `jevlint calibrate --labels`, which places the cutoff at the
   midpoint of the clean/defect gap rather than just above the clean band. A
   cutoff fitted to the edge of the observed clean set sits exactly on the
   boundary it was meant to clear.
5. Re-run on code the corpus has never seen. Expect to find a missing class.

---

## 5. Running it on this repository

The real generalisation test: 788 subjects across `src/`, `test/` and
`tools/` — code written normally, nothing planted.

**Zero findings.** 18 subjects of 737 cached verdicts scored at or above 0.40;
the highest anywhere in the repository was 0.68, just under its 0.69 cutoff.
Cost: 34 requests, 477k input tokens, $0.020, 9.4 seconds.

A 0.0% flag rate is the right shape for a tool you would leave switched on, but
the two subjects nearest the line were both correct, and both were in this
repository's own test suite:

- `test("batch: no batch exceeds the request ceiling")` scored **0.68–0.73**
  across runs. The body looped over batches and asserted the ceiling only
  `if (b.subjects.length > 1)` — so a planner that returned one subject per
  batch would have satisfied it vacuously, verifying nothing the title claims.
- `test("report: an incomplete run says so in every format")` scored **0.64**.
  It checked two formats of three.

Both are fixed, with the reason recorded at the call site. That is the
`test-name-matches-body` rule finding real weak assertions in the test suite of
the tool that implements it, which is the most convincing evidence here — and
notice neither is a thing any linter, type checker or coverage tool would
report. Coverage would have called both tests covered.

The first of those also sat *inside the model's own wobble band*: 0.73 on one
run, 0.68 on the next, across a 0.69 cutoff. That is precisely the case
`jevlint calibrate`'s stability table exists to surface, and precisely the case
not to automate on. It belongs in front of a person, which — at `severity:
warning` — is where it goes.

---

## 6. Bugs the tool and the tests found in the tool

Recorded because they are all in the category "looks like it works":

| found by | bug |
| --- | --- |
| self-lint | `.js` and `.mjs` are claimed by **both** the `JavaScript` and `Jsx` grammars, so `languages: [TypeScript, Tsx, JavaScript, Jsx]` matched every JS node twice and reported every finding twice. Subject count halved on the fix, from 1562 to 788. |
| self-lint | Pointing the pack at `src/` produced **0 subjects** — the rules covered TypeScript and this repo is `.mjs`. It read as a clean repository. The "N rules matched nothing" line is what caught it, which is the whole argument for printing that line. |
| self-lint | `interface_declaration` does not exist in the JavaScript grammar, and ast-grep rejects the **entire rule set** over one invalid kind rather than the offending rule. Now reported as a configuration error naming the kind, instead of an exec stack trace. |
| tests | A per-rule `unsureBelow` was validated and then dropped on the floor: the field was never copied into the normalized rule, so the override silently did nothing. |
| tests | `describe()` formatted `finding.value.toFixed(2)` before checking for a missing verdict, so a failed request crashed the reporter — a crash in the fail-open path, which is the worst possible place for one. |

---

## 7. Things worth knowing about the API

Confirmed against the live service while building this.

- **The limits are token budgets, not question counts.** 64Ki for the whole
  request, and an independent 32Ki for the `state` alone. The state fills
  first, because the state is what carries the file. Over a thousand questions
  in one request is fine; "how many questions can I ask" is the wrong worry.
- **255 is the cap on `choice` options**, not on questions. This tool never
  uses `choice`, so the memorable 256 is not a limit here at all. The
  `batchSize` default of 256 is a self-imposed blast radius and nothing more.
- **Don't predict the ceiling, react to it.** `max_tokens_exceeded` is the one
  400 a caller can fix, and halving the question set on it means the token
  estimator only has to be roughly right. It is deliberately pessimistic.
  **Half-wrong, and section 13 says which half.** Halving the questions rescues
  a request over budget and does nothing for a STATE over budget, since every
  half still carries the same state. That case loses its verdicts outright, so
  the estimator's accuracy on a state is a correctness property rather than a
  cost optimisation. An implementer following this bullet alone would build
  exactly the wrong thing.
- **A `noul`'s criteria must be nested under `criteria`.** A flat
  `{true, false}` returns 200 with the criteria silently discarded; the only
  visible symptom is a smaller input-token count. `rules.ts` rejects the shape
  so it cannot reach the wire.
- **A `noul` returns no confidence**, only a probability. So there is no
  `unsure` routing for noul rules — the score scale is what buys that.
- **Latency is ~200–400 ms** per request and barely moves with question count,
  which is what makes one-request-per-file viable.

---

## 8. What this does not do

- **No editor integration and no autofix.** The economy of the tool comes from
  batching across a whole rule set with one state per file, and a linter's rule
  callback is synchronous and per-file. There is no seam for that.
- **It is not deterministic.** The cache is what makes two runs agree, which is
  why it is not merely a speed optimisation: without it an author and a
  reviewer can see different findings on the same commit.
- **The matcher fails silently.** A node no matcher selected is never asked
  about and appears in no report. Write matchers that over-match; the "N rules
  matched nothing" line is the only place this is visible.
- **It does not replace anything.** Everything a compiler, type checker or
  conventional linter can decide mechanically is deliberately out of scope,
  and the model is measured to be *poor* at defects needing knowledge of a
  specific API's behaviour. The complement is the point.
- **The within-file call graph is a name-occurrence test**, not a resolved one.
  A shadowed local or a symbol name inside a string produces an edge a real
  analyzer would not. It is only ever shown to the model, never used to decide,
  and for "does this name describe its role among its callers" an
  over-inclusive edge list is the safer error. Cross-file edges are out of
  scope; `imports` is the cross-file signal instead.
- **Two labels in the corpus are arguments, not facts.** "Code quality" has no
  referee. Each label carries its reason so a reader can disagree with a
  specific claim rather than with the aggregate — and the fitted cutoffs are
  fitted to those opinions.

---

## 9. Batching axis: one state per file, or one per rule?

The state was per FILE: send a file's source, ask about every match in it. The
alternative is per RULE: send only what the matcher caught, from anywhere, and
never send a file whole.

One correction to state up front, because an earlier wording of this section got
it wrong: the rule axis does **not** reliably substitute "each match's enclosing
function" for the file. `local` attaches an enclosing function only where the
match is a *fragment* inside one -- when the match IS a named symbol, `local`
attaches nothing and the subject is effectively on `bare`. Verified against the
planner's own states: both `fn-name-promises` variants match whole functions, so
all 79 of their corpus subjects get zero attached context. That makes the arm
loss below sharper than first described, not milder.

Both are implemented (`--group file`, `--group rule`), a scheduler costs them
per rule (`--group auto`), and `tools/grouping.ts` measures them.

### Scale: a round-trip saving, not really a cost saving

Planned with `--dry-run`, which costs nothing. **These are the shipped
configuration** -- both packs loaded, at the shipped `--rule-batch-cap 32`:

| | file axis | rule axis @32 | rule axis @256 |
| --- | --- | --- | --- |
| tokio, 10,886 subjects | 896 req / 5.94M tok | **268 req** / 5.02M tok | 80 req / 4.97M tok |
| vue, 19,659 subjects | 1,739 req / 15.01M tok | **671 req** / 14.26M tok | 222 req / 14.15M tok |

At the shipped cap that is **3.3x and 2.6x fewer requests, for 15.5% and 5.0%
fewer tokens.** Since the API prices tokens, the rule axis buys latency and
rate-limit headroom, not money.

**Correction.** An earlier version of this section quoted "14.6x fewer requests,
20% fewer tokens" and "8-15x / 8-20%". Those figures were the naming pack only,
on tokio only, at an uncapped batch of 256 -- a configuration nobody runs, since
`DEFAULT_RULE_BATCH_CAP` is 32 and `rules/comments.yml` loads by default. Adding
the second pack and the cap roughly quarters the request saving. The direction
survives; the magnitude was overstated by 3-4x.

And the token saving is almost entirely one thing. On vue, 583 file-axis batches
hold 1-2 subjects — 50.6% of all requests but only 6.3% of tokens — and that
6.3% is **81% of the entire token delta**. 495 of those thin batches are
`module-name-describes-contents`, which has `subject: file` and is therefore one
request per file by construction. The rule axis's win is removing thin batches,
not amortising source.

### The density crossover exists and is unreachable

The theory was that density decides: amortising a file over many matches wins
when matches per file is high, loses when it is low. The direction is confirmed
strongly — a 14-point single-rule sweep on tokio and an 8-point one on vue show
the token ratio rising monotonically with density, from 0.057 at 1.14
matches/file to 0.998 at 139 — but **the crossover sits at about 135 distinct
matches per file**, an order of magnitude past the densest rule anyone writes,
and tokio never reaches it.

The reason is in this repository's own code: `buildRuleState` deduplicates
shared enclosing functions, which bounds the rule axis's context cost near the
file's own source instead of letting it grow with density. Before that
deduplication existed the rule axis cost 37% MORE than the file axis on tokio;
after it, 20% less.

One measurement subtlety: density has to be counted after subject-text
deduplication. A `kind: identifier` rule on tokio has a raw density of 193.9 but
a ratio of 0.712 — because 73,092 identifiers collapse to 4,699 distinct
question texts, putting it exactly on the effective-density curve at 12.46.

### Accuracy: the axis moves verdicts, and most of that was the cutoff

An earlier version of this section reported the rule axis carrying **2.5x the
false positives** — 306 subjects, 4 against 10 — and that number is retracted
on two counts. It compared two axes at cutoffs fitted on one of them, which
measures the mismatch and calls it the axis; and it predates both the cutoff
refit and the corpus relabelling in section 10, so it is not comparable to
anything measured since. Refitting each axis on its own answers, same corpus,
same run, 276 subjects, 15 rules, 2 passes:

| axis | cutoffs | precision | recall | tp/fp/fn |
| --- | --- | --- | --- | --- |
| file | shipped (fitted on this axis) | 0.977 | 0.915 | 43/1/4 |
| rule | shipped (fitted on the *file* axis) | 0.955 | 0.894 | 42/2/5 |
| file | refit on its own answers | 0.978 | 0.957 | 45/1/2 |
| rule | refit on its own answers | 0.936 | 0.936 | 44/3/3 |

Refitting recovers most of the gap: the rule axis goes from 42/2/5 to 44/3/3,
buying back 2 defects for 1 false positive. What is left against the refitted
file axis is **1 fewer true positive and 2 more false positives out of 276** —
a real direction, on 3 events, which is not enough to put a ratio on. The two
axes disagree on 1.4% of decisions (4 of 276), mean absolute delta 0.059.

`docs/data/grouping-refit.json`, reproducible with
`tools/grouping.ts --repeat 2 --configs file:256,rule:256 --fit-per-config`.

#### What the refit does per rule, and the one rule no cutoff saves

The corpus-wide table above mixes the comment rules' marker contamination
(section 10) back in. Fitting each pack on the corpus it was calibrated
against, forced onto the rule axis, isolates what refitting actually buys —
free, from the records, with `jevlint replay <record> --labels corpus/labels.json`:

| rule | arm here | n | at shipped | refit | what changed |
| --- | --- | --- | --- | --- | --- |
| `fn-name-promises` | `local` | 41 | 0.76 → 6/0/0 | 0.68 → 6/0/0 | nothing |
| `fn-name-promises-rust` | `local` | 35 | 0.68 → 5/0/1 | 0.80 → 5/0/1 | **nothing, and nothing can** |
| `var-name-describes-value` | `local` | 52 | 0.61 → 3/0/0 | 0.57 → 3/0/0 | nothing |
| `var-name-describes-value-rust` | `local` | 17 | 0.60 → 3/0/0 | 0.63 → 3/0/0 | nothing |
| `test-name-describes-code` | `bare` | 7 | 0.95 → 2/1/0 | 0.96 → 2/0/0 | −1 false positive |
| `test-name-describes-code-rust` | `bare` | 7 | 0.93 → 2/1/0 | 0.94 → 2/1/0 | nothing; unseparable on both axes |
| `test-name-verifies-claim` | `bare` | 7 | 0.54 → 4/0/0 | 0.67 → 4/0/0 | nothing |
| `test-name-verifies-claim-rust` | `bare` | 7 | 0.54 → 4/0/0 | 0.55 → 4/0/0 | nothing |
| `module-name-describes-contents` | `graph` | 8 | 0.62 → 1/0/0 | 0.54 → 1/0/0 | nothing |
| `module-name-describes-contents-rust` | `graph` | 6 | 0.52 → 1/0/0 | 0.54 → 1/0/0 | nothing |
| `comment-describes-declaration` | `local` | 10 | 0.83 → 4/0/1 | 0.44 → 5/0/0 | −1 false negative |
| `comment-describes-declaration-rust` | `local` | 9 | 0.59 → 4/0/0 | 0.69 → 4/0/0 | nothing |
| `comment-describes-declaration-js` | `local` | 4 | 0.54 → 2/0/0 | 0.57 → 2/0/0 | nothing |
| `comment-describes-block` | `bare` | 3 | 0.97 → 1/0/1 | 0.93 → 2/1/0 | traded a miss for a false positive |
| `comment-describes-block-rust` | `bare` | 3 | 0.94 → 1/0/1 | 0.91 → 1/0/1 | nothing |

**4 of 216 decisions change.** Three results in that table matter:

1. **Most cutoff movement is midpoint drift, not signal.** All 15 rules want a
   different number on the rule axis and 12 of them change no decision at all,
   because a fitted cutoff is the midpoint of a wide gap and the midpoint can
   slide the width of the gap for free. Reading the cutoff instead of the gap
   would have made this look like fifteen rules needing attention. Three do.
2. **The one big move is real.** `comment-describes-declaration` wants 0.44 on
   the rule axis against 0.83 on the file axis. That rule is `located` on the
   file axis and `local` on the rule axis: stripped of the file, the same
   question answers the same defects with much lower values, and the
   file-fitted 0.83 silently misses one. This is the mechanism the old "2.5x"
   number was really seeing.
3. **One rule changes class, and no cutoff fixes it.** `fn-name-promises-rust`
   is 6/0/0 with a separating gap on the file axis and 5/0/1 with *no*
   separating cutoff on the rule axis. Losing the file loses the evidence, and
   fitting cannot put it back. This is why the scheduler refuses to move a
   file-bearing rule (`FILE_BEARING_ARMS`) and why both packs pin `axis: file`.

So the rule axis is usable on this corpus **if you refit for it**, with one rule
that should stay on the file axis whatever the token bill says. `jevlint replay
<record> --labels <labels>` exists for exactly this: a cutoff is a claim about a
specific set of answers, and anyone holding the record can re-derive it for
free, on either axis, without an API key.

#### The decomposition below is confounded, and adversarial review caught it

Four independent reviewers refuted the first version of this section with high
confidence, and two of their objections stand against the measurement itself
rather than its wording:

- **The solo-vs-batched comparison does not isolate neighbours.** It was meant
  to hold the state shape constant and vary only the neighbour list, but
  `buildRuleState` and `buildState` differ in at least four further ways per
  subject -- the `reviewing` sentence, the `note_on_independence` sentence
  (which a one-subject state should never have carried), and a `rule` field
  swapped for a `file` field. So "context held constant" was not true.
- **The context change is the LARGER perturbation, not the free one.** Against a
  same-configuration repeat floor of 0.014, the context change moves answers by
  0.057 mean absolute delta and the neighbour change by 0.049. The first version
  of this section had that backwards because it read 0 decision flips as 0
  effect. The honest statement is that the context change moves values more and
  that neither effect's impact on *decisions* is measurable on 134 subjects.

What survives is the structural argument two sections down, which does not
depend on the decomposition: the rule axis removes the whole-file arm, and the
rule that needs it loses it. That was independently confirmed by the vue
fallback counts and by the corpus false-positive count.

#### Retraction: it is not anchoring

The first reading of this blamed anchoring — unrelated snippets sharing one
state pulling each other toward the middle — on the strength of 3 flips in 134
corpus subjects at batch 256, all in one rule. A proper batch-size sweep on both
large repositories retracts that, on four counts:

1. **Flips start at batch 4** — the smallest batch with any neighbour at all —
   and **saturate by 16** instead of growing with batch size. There is no safe
   sub-threshold to sit under.
2. **They are noise-dominated.** On vue, the 3 flips at batch 256 exactly equal
   its own pass-to-pass flips at batch 1. Against a same-configuration noise
   floor of 0.011-0.016 mean absolute delta, the batched delta is 0.027-0.052 —
   real in magnitude, but 9 of 10 flips across both repositories sat within
   0.115 of their cutoff, a borderline band holding only 1.9-3.0% of subjects.
3. **The original flips did not reproduce.** They were not concentrated in
   `fn-name-promises-rust`; at scale they land in whichever source-bearing rule
   has the most subjects, and the `graph`-arm module rule never flipped once
   anywhere.
4. **The corpus could not have answered the question.** Its largest per-rule
   group is 42 subjects, so `rule:64` and `rule:256` compile to the *identical*
   plan and returned identical numbers. "Batch 256" on this corpus never meant
   more than 42 neighbours. A real rule-axis batch is capped by the 32Ki state
   budget at 135-140.

Point 4 is the methodological lesson, and it is the same one as section 4: a
corpus can return a confident number for a question it is structurally unable
to answer, and nothing in the number says so.

#### What does move verdicts: arm degradation

A rule-axis state spans files, so it cannot carry *the* file — `planRuleBatches`
substitutes `local` for `located`. Three independent measurements line up:

- `var-name-describes-value` is not separable at any cutoff without the file
  (section 3).
- On vue, 101 of 147 rule-axis batches fell back from `located`, covering 58.4%
  of subjects and 69.2% of tokens — and that population is essentially that one
  rule (11,496 of 19,659 subjects).
- Forcing the rule axis took false positives from 4 to 10 with true positives
  flat.

So the accuracy cost is structural, not statistical: **a rule whose evidence is
the file loses its evidence.** That is a mechanism, and it is what the scheduler
now enforces — a file-bearing arm (`located`, `full`) holds its rule on the file
axis, and cost optimisation happens only among the rules where it is free.

Per-rule on tokio, the pattern is exactly that:

| rule | arm | requests | tokens | why |
| --- | --- | --- | --- | --- |
| `module-name-describes-contents-rust` | graph | 377 → 4 (94x) | **-52.7%** | one match per file, so file grouping sends one question per file |
| `fn-name-promises-rust` | located | 312 → 23 (13.6x) | -38.6% | subject is a whole function, so `local` attaches nothing extra |
| `var-name-describes-value-rust` | located | 242 → 24 (10.1x) | -26.5% | subject is a fragment, so `local` attaches an enclosing body to each |
| `test-name-*-rust` | bare | 85 → 3 (28x) | **+1.2%** | no file to amortise either way |

The `graph` and `bare` arms are where the rule axis is free. Composition note:
the rule axis is exactly additive across rules (23+24+3+4 = 54 requests, tokens
summing to the unit), while the file axis is not — two `located` rules share one
state per file, so per-rule figures do not partition the combined total.

### The answer to "does scheduling change the scores"

No, and yes, and the distinction matters:

| comparison | decision flips |
| --- | --- |
| scheduler vs forced rule axis | **1 / 306 (0.3%)** |
| scheduler vs forced file axis | 8 / 306 (2.6%) |
| forced file vs forced rule | 9 / 306 (2.9%) |

The scheduler adds no disagreement of its own — it inherits whichever axis it
picked. So **the axis is not verdict-neutral and the scheduler cannot be made
neutral by being clever.** What it can do is decline to move a rule that would
lose evidence, which is what it does.

Consequences, all shipped:

- `--group file` is the **default**, because it is the accurate axis.
- `--group rule` and `--group auto` are opt-in, and the usage text says what
  they cost.
- Every calibrated rule carries `axis: file`, because a cutoff fitted on one
  axis is not fitted for the other.
- `--explain-schedule` prints the axis chosen per rule and why.

---

## 10. Two new rule families

### Tests: the two failure modes are nested, not orthogonal

The original single test rule asked one question whose criteria listed both
"exercises a different case" and "asserts nothing at all". Splitting those into
two rules — `test-name-describes-code` (the code does something else) and
`test-name-verifies-claim` (the code would pass anyway) — first made things
**worse**: 1.0/1.0 became 0.5/0.5 on the second rule and 0/2 recall in Rust.

The cause was a labelling error founded on a wrong model of the domain. The
classes are **nested, not disjoint**: a test that exercises the wrong case also
fails to establish its name, so `verifies-claim` ⊃ `describes-code`. Labelling
the wrong-case defects as belonging to both put every rule back to 1.0/1.0.

Worth stating because the failure looked like a bad question and was a bad
ontology. `verifies-claim` firing on both classes was it being *right*.

| rule | cutoff | precision | recall |
| --- | --- | --- | --- |
| `test-name-describes-code` | 0.95 | 1.00 | 1.00 |
| `test-name-describes-code-rust` | 0.93 | 0.67 | 1.00 |
| `test-name-verifies-claim` | 0.54 | 1.00 | 1.00 |
| `test-name-verifies-claim-rust` | 0.54 | 1.00 | 1.00 |

### Comments: a comment is a claim nothing checks

`rules/comments.yml`. The matcher pairs a comment with the code it sits above
using `follows:` with a pattern, and **a `follows` capture propagates to
metavariables** — so `$DOC` hands the question the comment by name while the
matched node is the code. Both halves named, the same shape that makes the test
rules sharp.

| rule | cutoff | precision | recall |
| --- | --- | --- | --- |
| `comment-describes-declaration` (TS) | 0.83 | 1.00 | 1.00 |
| `comment-describes-declaration-rust` | 0.59 | 1.00 | 1.00 |
| `comment-describes-declaration-js` | 0.54 | 1.00 | 1.00 |
| `comment-describes-block` | — | not calibrated | |
| `comment-describes-block-rust` | — | not calibrated | |

The declaration rules separate perfectly in three languages over nine labelled
drifts: a unit that changed, a claimed absence of mutation that mutates, a
claimed ordering that is reversed, a documented parameter that no longer exists,
a claimed throw that returns false. The hard clean cases — vague comments,
redundant comments, comments explaining *why* — are all correctly ignored,
which is the axis working: the question is whether the claim is false, not
whether the comment is good.

**The block rules are not calibrated and ship saying so**, with cutoffs parked
above every observed answer and `severity: info`. They answer 0.89-0.96 to
almost everything. Two fixes were tried and neither separated them: handing the
question the matched statement alongside its container (which did take precision
to 1.0), and rewording to the declaration rule's proven "a specific claim is
contradicted" shape. Whether the question is wrong or merely untested is not
established — three subjects is below what a gap statistic can speak to.

#### A corpus annotated with comments cannot calibrate a rule about comments

The first comment-rule run produced a false positive at 0.78 on
`corpus/ts/session.ts:20`. The "comment" it judged was this repository's own
`// CLEAN: a predicate whose truth takes one step of reasoning to check …`
corpus marker, sitting exactly where a doc comment sits.

Every naming-corpus file is annotated with `// DEFECT` / `// CLEAN` comments
directly above declarations, which is precisely the shape
`comment-describes-declaration` matches. The comment rules are therefore
calibrated only on `corpus/ts/session_store.ts`, `corpus/rust/budget.rs` and
`corpus/js/legacy_cart.js`, where the markers sit *above* a real doc comment so
the doc comment is what the matcher pairs with the code.

It also showed up in the axis comparison: that subject scored 0.16 on the file
axis and 0.775 on the rule axis, because with the whole file visible the model
reads the marker as an annotation and without it reads it as documentation. The
largest single disagreement in the whole comparison was an artefact of how the
corpus is written.

---

## 11. Rewrites and fixes this round

| found by | what |
| --- | --- |
| the port | `describe()` and the `unsureBelow` override bugs from section 6 would both have been caught by types; neither was, because JavaScript. The TypeScript port found nothing new, which is itself the honest result — 678 type errors were all missing annotations. |
| the gap report | It called a rule `rewrite` on **three** data points. A widest-gap statistic over three answers is noise, and "rewrite the sentence" is expensive advice to give on noise. `thin` now covers anything under six. |
| the comment rules | `subject: enclosing` reported findings at the *container's* line, so every match inside one function collapsed onto one reported line and per-line corpus labels could not tell them apart. Report location and judged subject are now separate concerns: the finding points at the match, the question describes the container. |
| the comment rules | A promoted subject did not tell the question which node inside the container had matched, which is unanswerable when the container holds several candidates. The matched node is now handed over as `matched`. |
| the scheduler | Optimising tokens alone silently bought the rule axis's extra false positives. The constraint is now structural (file-bearing arms hold their rule) rather than a cost comparison. |
| adversarial review | `note_on_independence` ("these items come from different files and have nothing to do with one another") was added to EVERY rule-axis state, including a one-subject state where it is simply false. It also confounded the solo-vs-batched comparison it existed to support, which was supposed to vary only the neighbour list. Now added only when there are neighbours. |
| adversarial review | The docs described the rule axis as carrying each match's enclosing function. False for any rule whose subject is already a named symbol; corrected above and in the usage text. |
| adversarial review | Switching axis invalidates **every** cached verdict, because the axis is in the cache key: 193 keys under each axis, 0 shared. `prune` exists but the CLI never calls it, so both sets accumulate. This breaks the "commit the cache, CI lints without a key" workflow the README recommends the moment anyone changes `--group`. Documented in the usage text; the CLI still does not prune. |
| distribution | `astGrepBin()` resolved `../node_modules/.bin/ast-grep`, which does not exist when npm hoists. Verified by installing the packed tarball into a clean project and linting real files through it. |

---

## 12. What is still not measured

A completeness critique over this repository named fifteen gaps and twelve
overclaims. Several were acted on in section 11 and in the corrections above.
The ones that remain are listed here, because a gap named in a document is a
gap a reader can weigh, and a gap left out reads as coverage.

Ordered by how much each would change the decision to prefer one batching axis.

1. **No labeled accuracy measurement on any large repository, on either axis.**
   Every accuracy figure here comes from `corpus/` — 13 files. All tokio and vue
   work is dry-run cost only. Worse, `tools/grouping.ts` resolves an unlabeled
   subject to `clean`, so any precision or recall column it prints for an
   unlabeled repository is arithmetic over fabricated labels. **Do not quote
   accuracy for tokio or vue from this repository; none was measured.** The fix
   is a labeled slice of each repo, sampled stratified on the file-axis score
   and oversampling the ±0.10 cutoff band where every observed flip lives.

2. **The `local` arm has never been measured.** `docs/data/arms.json` covers
   `bare`, `located`, `graph` and `full`; the string `local` does not appear in
   it. That is the arm the rule axis actually substitutes, so the load-bearing
   claim of section 3 — not separable on `bare`, separable on `located` —
   brackets it on both sides and says nothing about it. `tools/arms.ts` already
   accepts it (`--arms bare,local,located,graph,full`, about $0.03).

3. **The axis has never been compared with the arm held constant.** Every
   file-vs-rule comparison changes the arm and the neighbour set together, so
   the 4 → 10 false positives cannot be attributed between them. The clean
   control runs today: `--arm local --group file` against `--arm local --group
   rule`. This matters because the scheduler's whole design assumes the axis is
   verdict-neutral once the arm is held — an assumption that has not been
   tested.

4. ~~**No cutoff has ever been fitted on the rule axis.**~~ **Closed**, and the
   gap was right: refitting on the rule axis recovered most of the difference,
   the "2.5×" claim is retracted, and what survives is one rule that loses its
   separation with the file. Section 9, `docs/data/calibration-rule-axis.json`,
   `calibration-rule-axis-comments.json`, `grouping-refit.json`. Cost $0.005.
   Still open underneath it: the rule-axis cutoffs are documented but not
   *shippable* — a rule carries one `at:`, so running `--group rule` still
   needs the refit passed by hand with `--at`.

5. **No accuracy measurement at the shipped cap.** The sweep used
   1/4/16/64/256 — never 32, which is what ships.

6. **Review mode was never measured on either axis**, and it is the mode the
   documentation recommends for CI. A rule-axis run's request floor is the
   number of firing rules, so below roughly three changed files it costs *more*
   round trips than the file axis, and that gets worse as a pack grows. The
   full-scan figures do not transfer to the per-pull-request regime.

7. **The `--arm` override inverts the cost conclusion.** With `--arm bare` on
   the corpus, the rule axis costs *more* than the file axis. And because the
   scheduler's protection keys off the arms the subjects carry, `--arm bare`
   removes it entirely for any pack without explicit `axis:` pins.

8. **Neighbour composition is not in the cache key**, and batches are built from
   subjects sorted by file and line — so rule-axis batch-mates are contiguous
   file blocks, not a random sample. The cross-file interaction question was
   therefore never tested against a randomised partition, which is the only
   clean way to vary neighbours and nothing else.

9. **Switching axis invalidates the whole cache.** The axis is in the key, so
   the two axes share none of their 193 keys on the corpus, and the CLI never
   calls `Cache.prune()`. Committing the cache — which the README recommends so
   CI can lint without a key — breaks the first time anyone changes `--group`.
   Documented in the usage text; not fixed.

10. **No failure mode has been exercised on the rule axis.** A failed batch
    nulls every subject in it, so blast radius scales with subjects per request.
    Nothing has exercised rate limiting at the concurrency the axis is meant to
    unlock, and a rule-axis batch is named only `<rule-id> (N file(s))`, so an
    operator cannot tell which files lost verdicts.

11. **Wall clock at scale was never measured**, and latency is the only benefit
    of the rule axis that survived the cost analysis. The only timing data is
    the corpus.

12. **`note_on_independence` has never been ablated.** It is the only mitigation
    for crowding in the rule-axis state. If it is what keeps the axis usable its
    effect size should be known; if it does nothing it is prose in every state.

Two further overclaims worth stating plainly rather than burying:

- **"Flips start at batch 4, so there is no safe sub-threshold"** names a
  threshold where 4 was simply the smallest batch tested, on 3 flips against a
  same-configuration noise floor of 1.
- **The anchoring retraction is asserted with the same statistical power as the
  claim it retracts.** Flip counts at or below the pass-to-pass floor cannot
  establish absence any more than presence. And it does not reconcile its own
  counterexample: one tokio subject moved 0.535 across partitions with a
  within-configuration spread of ≤0.02, which is a partition moving a verdict.
  The honest position is that neither the effect nor its absence is established
  at this sample size, and that the structural arm argument is what the
  scheduler should rest on — which is what it now does.

The scheduler's live effect on the shipped configuration is also worth stating:
because every calibrated rule pins `axis: file`, **`auto` moves only the two
`comment-describes-block` rules — the two nobody has calibrated.** Meanwhile
`module-name-describes-contents`, the one rule whose `graph` arm survives the
switch untouched and which showed the largest per-rule saving (377 → 4 requests,
−52.7% tokens on tokio), is pinned shut. That is the safe default working as
designed and it is also, on this configuration, close to a no-op.

## 13. Running it on itself, as a code-quality tool

The question this section answers is not "does it run" — section 5 covered that
on an earlier version of the code — but **is it worth running on a codebase you
care about.** So it was pointed at this repository's own TypeScript (`src`,
`tools`, `test`, `corpus/build-labels.ts`), every finding was read against the
code, the real ones were fixed, and it was re-run until it converged.

One run: **1,377 subjects, 65 requests, ~1.02M input tokens, $0.043, 18s of
request time, under 5 seconds of wall clock.** Seven of the fifteen rules fire;
the eight Rust-only rules match nothing and say so. The whole exercise —
five scans, the fixes, and the API probes below — cost about $0.34.

### The score

| round | findings | real, by reading the code | what changed |
| --- | --- | --- | --- |
| 1 | 9 | 7 | as shipped before this section |
| 2 | 6 | — | after fixing the planner; **1 request failed, 100 verdicts lost** |
| 3 | 11 | 9 | after fixing the token estimator |
| 4 | 3 | 3 | after fixing the nine |
| 5+ | 1–3 | ~1 | converged; the tail flickers |

**9 real defects in 8,132 lines of TypeScript, for four cents a pass.** Two of them are
comments that had become false — the class nothing else can check. Six were
tests that did not verify the behaviour their own names claimed. One was a
binding named for its input rather than its value, six times over.

### The best defects came from running it, not from its rules

This is the result worth leading with, and it is not the flattering one. The
rules found comment drift and weak tests. The *run* found four bugs in the tool
itself, each one surfaced by a number in its own output that did not make sense:

1. **`6 batch(es) / 214 subject(s) fell back from `bare` to `bare`.`** A
   fallback from an arm to itself is not a fallback. The cause: the planner
   probed the arm against the state for **every match in the file at once**, so
   a file was degraded for having many matches rather than much source — and at
   `bare`, where nothing is leaner, it reported a step-down with nowhere to
   step. The fix probes the *irreducible* part of a state, what one subject
   alone costs, and splits the rest. It restored `located` for about 1,000
   subjects per run that had been quietly judged at `local`, which is the wrong
   arm for the rules that were calibrated on `located`.

2. **`1 request(s) failed: max_tokens_exceeded`, and 100 verdicts lost.** The
   accurate planner immediately hit a wall the conservative one had been hiding.
   Reproducing it found the important part: the request was refused *with a
   single question attached*, which is the signature of a state over budget, and
   `askSplitting` — the client's only recovery — halves the questions and cannot
   shrink a state. So this failure mode is unrecoverable by design, which makes
   the estimator's accuracy a correctness property, not a cost optimisation.

3. **The token estimator used one ratio for every payload.** Measured against
   the server's own `usage.input_tokens`, on three shapes:

   | payload shape | measured | the single 3.4 ratio was |
   | --- | --- | --- |
   | a file's source inside a state | 3.37 chars/token | accurate to 1% |
   | per-subject metadata records | 2.18 chars/token | **36% under** |
   | a batch's questions record | 3.68–3.85 chars/token | 15–26% over |

   Metadata records are small and syntax-dense; a questions record is large and
   repetitive, and a tokenizer does far better on the second. No single pair of
   constants fits both, which is why the estimator now charges string values and
   JSON syntax separately — and why the remaining error is absorbed by margins
   rather than by pretending the model is exact.

4. **Two budgets need two margins.** The state budget is unrecoverable and the
   estimate's worst case (−12%) is there, so the planner packs to 1.25× under
   it. The request budget is recoverable and the estimate runs 15–26% *over*
   there, so 1.1× is enough. Putting enough pessimism in the ratios to cover
   the state made `--dry-run` overstate a real bill by 22%; splitting the two
   concerns brought that to about +9%, which is now documented as a bound
   rather than a quote.

A fifth observation is about the tool's own advice. The README says to read
`jevlint gaps` first. On this repository it prints **`rewrite` for all seven
rules that fired** — because a gap needs two classes and real code is 99.8%
clean, so there is nothing on the far side of the gap to separate from. The
medians are the informative part there (`var-name-describes-value` sits at 0.10
across 787 matches, so its 0.61 cutoff is nowhere near the clean band), and
"read the gap first" is advice for a *labeled corpus*, not for your repository.

### What the rules were right about

The two comment findings were both real and both the kind a reviewer skims past:

- `formatGithub`'s doc opened with "Everything is emitted as `notice` or
  `warning`, never `error`" while the first line of its body passes `error`
  through for any rule with `severity: error`. The rest of the same comment
  explains how to opt into that — the comment contradicted itself, and the
  sentence a reader would quote while auditing "can this fail my build" was the
  false one.
- `ruleLanguages`'s doc claimed it returns "every language any loaded rule asks
  for, **plus the probes' languages**". The probes take that list as input, so
  there is nothing to add; the comment described its caller.

The test rule's six hits were more interesting than expected, because fixing
them changed the tests' *power*, not their style:

- "no batch exceeds the request ceiling" checked only batches holding more than
  one subject.
- "every subject lands in exactly one batch" asserted that the subject count
  totalled 15, which a duplicate plus a drop also satisfies.
- "a rule's own axis pin is never overruled" never established that the
  scheduler wanted the other axis. **Writing the stronger version disproved my
  own assumption**: for a rule on a lean arm the rule axis is always cheaper, so
  the disagreeing direction is a `file` pin, not a `rule` pin. The test now
  proves the premise before asserting the pin.
- "two symbols sharing a name do not form a call edge" checked one half of the
  edge, so a bug recording the reverse direction passed.
- "every symbol has call arrays" tested one symbol, and it was the excluded one.
- "the cap is honoured and the state budget closes a batch" showed that *a*
  batch closed, which the request budget would also produce.

### The caveats an adopter needs

- **It flagged what I had just written.** Every naming hit was in code from the
  last hour of work, including code written to fix an earlier hit. That is a
  point in favour of `review` mode on a diff and against `check` on a whole
  repository: the rules find fresh mistakes, and old code has had its names
  argued over already.
- **The residue flickers.** After the fixes, consecutive passes over identical
  code report 1, 2 and 3 findings, drawn from a pool of four borderline tests at
  0.55–0.70 against a 0.54 cutoff. One finding is stable across every pass and I
  disagree with it: `batch/rule: every subject lands in exactly one batch,
  grouped per rule` now verifies placement by identity, batch count, grouping
  and rule purity, and is still flagged at 0.65–0.70. That is a false positive
  three rounds of strengthening could not clear.
- **So the cutoff is the adopter's job, again.** `test-name-verifies-claim`'s
  clean band on this repository has a median of 0.18 and a tail to 0.70, while
  its corpus-fitted cutoff is 0.54. The flags are genuine outliers against that
  median — the rule is pointing somewhere real — but anyone running this on
  their own tests should expect to refit, exactly as section 4 says and as this
  section demonstrates on the author's own code.
- **A state over budget still loses its verdicts.** The planner now avoids that
  case by margin rather than recovering from it. The fix is for the client to
  step the arm down and retry when question-splitting is exhausted, which needs
  a batch to carry enough to rebuild its own state. Not done.

### Verdict

Worth running, in review mode, on code you are about to ask someone to read. It
found nine real defects here at four cents a pass, two of them in the class no
other tool checks and six of them tests that were quietly not testing what they
said. It is not a substitute for reading the output: a fifth of the findings
were wrong, and the most valuable four defects of the whole exercise came from
distrusting its own summary lines rather than from any rule it ran.
