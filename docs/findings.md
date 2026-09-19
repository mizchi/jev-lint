# Findings

Everything measured while building this, in the order it happened, including
the parts that went wrong. All numbers come from `corpus/` (10 files, 569
lines, 134 subjects, Rust and TypeScript) unless stated otherwise, against
`jev-1.13.0`.

Re-derive the tables without spending anything:

```bash
npm run replay        # re-score the recorded run under today's cutoffs
npm test              # 85 checks, no API key
```

The recorded runs are `docs/data/calibration.json` (three passes),
`docs/data/arms.json` (four state arms, two passes each) and
`docs/data/self-lint-cache.json` (the 737 verdicts behind section 5, kept as a
cache so the numbers there can be checked rather than taken on trust).

---

## 1. The headline

Eight rules over two languages, fitted to the corpus:

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

`tools/arms.mjs` runs the whole corpus once per state arm. The column that
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
- **A `noul`'s criteria must be nested under `criteria`.** A flat
  `{true, false}` returns 200 with the criteria silently discarded; the only
  visible symptom is a smaller input-token count. `rules.mjs` rejects the shape
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
