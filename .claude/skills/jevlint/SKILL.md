---
name: jevlint
description: "Use this skill when working with jevlint — a linter whose rules are one-sentence predicates judged by a model, with ast-grep as the matcher. Covers running it, writing a new rule, calibrating a cutoff against a labeled corpus, and building the evaluation loop that keeps a rule honest. Triggers: running `jevlint`, editing `rules/*.yml`, adding a rule pack, choosing a `state` arm or a `subject`, reading `jevlint gaps`, setting or moving an `at:` cutoff, labelling a corpus under `corpus/`, interpreting a run record in `docs/data/`, or any question about why a rule fires, misses, or cannot be separated. Also use it before claiming a rule 'works' — this skill defines what that requires."
---

# jevlint

A rule is an ast-grep matcher plus one sentence. **ast-grep decides which code
gets looked at; the sentence decides whether it is a problem; Jev answers the
sentence.** Every match in a file goes in one batched request.

The two halves fail in opposite ways, and knowing which half you are debugging
is most of the work:

| | who does it | how it fails |
| --- | --- | --- |
| `rule:` | ast-grep — exact, free, no model | **silently**: a node it misses is never asked about |
| `ask:` | the model, once per matched node | loudly: every answer shows up in `jevlint gaps` |

## Non-negotiables

1. **Never write a rule a compiler, type checker or conventional linter can
   decide.** Not a scoping convenience: the model is good at code that
   *contradicts a contract it declares about itself* and measurably poor at
   defects needing knowledge of a specific API (that `.sort()` is
   lexicographic, that a regex without `/g` matches once). Those belong to the
   existing tools.
2. **Never put a threshold in the question text.** The cutoff is calibration,
   and baking it into the sentence means every recalibration rewrites the
   question, so no run is comparable with an earlier one.
3. **Never ask for something the matched code cannot show.** This is the most
   common way a rule fails, and it looks exactly like a threshold problem: all
   answers land mid-scale, no cutoff separates, and rewriting the sentence does
   nothing. Check the subject before touching the wording.
4. **Confidence routes; it never gates.** Requiring confidence before reporting
   was measured costing 7–11 points of recall for nothing, because clean and
   broken code occupy the same confidence band. A low-confidence verdict over
   the cutoff is still reported — worded as a question for a human.
5. **Record every run you draw a conclusion from.** A cutoff is a claim about a
   specific set of answers. `jevlint calibrate --record path.json` then
   `jevlint replay path.json --labels corpus/labels.json` re-derives the fit
   for free, with no API key, forever.

## Running it

```bash
jevlint check src                  # judge whole files
jevlint review --base main         # judge only what the diff touched
jevlint gaps src                   # per-rule separation — on a LABELED corpus
jevlint calibrate corpus --labels corpus/labels.json --repeat 3 --record r.json
jevlint rules                      # what loaded, and every validation error
jevlint replay r.json --labels corpus/labels.json   # re-score and re-fit, free
jevlint check src --dry-run        # plan and price without asking anything
```

Exit codes: `0` clean, `1` findings, `2` configuration error, `3` requests
failed and nothing was reported.

**Reach for `review`, not `check`.** Review mode keeps only matches whose
subject overlaps a changed line. It is where the rules earn their keep: the
findings concentrate in freshly written code, because old names have already
been argued over.

Two lines of output that are never noise:

- **`N rules matched nothing`** — the only place a dead matcher is visible.
  Check it before trusting a clean run.
- **`N batch(es) fell back from X to Y`** and **`N without a verdict`** — those
  verdicts answered a leaner question, or no question at all.

## Writing a new rule

```yaml
- id: fetch-timeout
  languages: [TypeScript, Tsx]
  rule:
    pattern: fetch($$$ARGS)          # over-match on purpose
  ask: fetch must always be given a timeout, such as AbortSignal.timeout.
  note: not a violation if it is inside a retry wrapper that already sets one.
  kind: score                        # or noul
  at: 2.0
```

Work in this order.

### 1. Over-match in the matcher

The matcher's job is to find candidates cheaply; the sentence's job is to
judge. A matcher tightened by hand to avoid false positives is a matcher that
misses silently, and `score` level 0 (`not-applicable`) exists precisely so the
model can say "your matcher caught something this rule was not written about" —
which is cheaper to read in a report than to prevent in YAML.

### 2. Capture the pair being compared

```yaml
rule: { kind: function_declaration, has: { field: name, pattern: $NAME } }
ask: The body of this function does something materially different from what its name promises.
```

**A matcher capture is the sharpest state available.** "Does this body do what
`$NAME` promises" is answerable; "is this well named" is not. Captures reach the
model by name, and `follows:` with a pattern propagates into metavariables too —
that is what lets a comment rule name the claim (`$DOC`) *and* the code it sits
above.

### 3. Choose `score` or `noul` by what the answer means

- **`score`** — an ordered conclusion, *how badly* this breaks the rule, on a
  fixed scale: `not-applicable`, `satisfied`, `arguable`, `violation`. Also
  returns a confidence, which is what lets an uncertain verdict be routed to a
  human instead of dropped.
- **`noul`** — an independent predicate, *whether* something holds. A bare
  probability, no confidence, its own cutoff.

Never ask an ordered conclusion as a `choice`: the ordering is thrown away,
adjacent levels split the probability mass, and the result arrives as a low
confidence indistinguishable from real uncertainty.

`noul` criteria **must** be nested:

```yaml
criteria:
  "true": what a violation looks like
  "false": what clean looks like
```

A flat `{true, false}` at the top level returns HTTP 200 with the criteria
silently discarded; the only symptom is a smaller input-token count.
`rules.ts` validates the shape so the mistake cannot reach the wire.

### 4. Choose the `subject` so it can contain the answer

| `subject` | judges | right for |
| --- | --- | --- |
| `node` (default) | the matched node | "this `fetch` has no timeout" |
| `enclosing` | the containing function | "this `catch` hides a failure" |
| `file` | the module as an **outline** — path, public items, imports | "is this module named for what it contains", the only way, because a file's text never mentions its own path |

### 5. Choose the `state` arm by the same test

| arm | carries | note |
| --- | --- | --- |
| `bare` | the matched code and the file name | cheapest, and the most cache-stable: an unrelated edit in the same file cannot move the verdict |
| `local` | + each match's enclosing function, deduplicated | what the rule axis substitutes for `located`; **never measured against the others** |
| `located` (default) | + the whole file source | the verdict now depends on the whole file |
| `graph` | + path, imports, symbol table with call edges; **no source** | small at any file size |
| `full` | source and graph | hits the state budget soonest |

> Give the question the least context that still contains the answer.

Not a quality knob. More context is not better; it is a choice of which error
you would rather have. Measured: `var-name-describes-value` is **not separable
at any cutoff** on `bare` and fully separable on `located`, because `const
timeoutSeconds = 5000` is only wrong if you know 5000 is milliseconds — visible
where the binding is *used*. A rule whose matcher already captures both sides
of the comparison, as the test rules do, gains nothing from a richer arm and
ships on `bare`, winning cache stability for free.

`tools/arms.ts` measures this per rule — four arms, two passes, about two cents.
**Run it rather than guessing, and re-run it whenever you change a rule's
matcher or split a rule**: the shipped `arms.json` measured the pre-split pack,
so the two current test rules sit on `bare` by inheritance from a rule that no
longer exists.

### 6. One sentence, several grammars

`languages: [TypeScript, Tsx]` works when the matcher is valid in both. Rust and
TypeScript spell the same structural idea with different node kinds, and
**ast-grep rejects a rule naming a kind absent from the target grammar — and one
rejected rule fails the whole scan.** So those need two rules sharing one
sentence through a YAML anchor:

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

Share it with an anchor rather than copying: copies drift, and a drifted copy is
a cache that never hits. Anchors are scoped to one YAML document, which is why a
rule file may be a *list* as well as a `---` stream.

Then `jevlint rules` to confirm it loaded, and `--dry-run` to price it.

## Calibration

### Read the gap, not the cutoff

```
rule                      kind  matched reported cutoff median gap   suggest verdict
fn-name-promises          noul  26      6        0.67   0.10   0.55  0.65    works
```

| verdict | what to do |
| --- | --- |
| `works` | nothing. Any cutoff inside the gap gives the same answers. |
| `move` | set the cutoff to `suggest`. The rule discriminates; the threshold is misplaced. |
| `rewrite` | the answers are not separated. **No cutoff helps.** First check non-negotiable #3, *then* rewrite the sentence. |
| `silent` | the matcher never fired. Loosen it. |
| `thin` | too few matches to judge. **Not a pass.** Anything under 6 matches is thin. |

A wide gap means the exact number does not matter: refitting this repository's
own rules produced cutoffs up to 0.03 away with **not one decision changed**.
Conversely, all 15 rules want a different number on the rule axis and 12 change
no decision, because a fitted cutoff is the midpoint of a gap and the midpoint
slides for free.

### `gaps` is for a labeled corpus, not for your repository

A gap needs two classes. Real code is ~99.8% clean, so on real source `gaps`
prints **`rewrite` for every rule that fires** — which means nothing. There,
read the **median and the headroom** instead: the distance from the highest
clean answer to the cutoff. That is the number that predicts your next false
positive.

### The procedure

```bash
# 1. label defects as comments next to the code, so line numbers cannot drift
#      // DEFECT (rule-id): reason
#      // CLEAN: why this is not a violation
node --experimental-strip-types corpus/build-labels.ts        # derives labels.json
node --experimental-strip-types corpus/build-labels.ts --check # CI: labels in sync

# 2. fit, repeatedly, and record
jevlint calibrate corpus --labels corpus/labels.json --repeat 3 --record r.json

# 3. re-derive for free, forever
jevlint replay r.json --labels corpus/labels.json
```

`--repeat` reports which subjects changed *decision* between passes. A wobbly
score with a stable decision is the good case: the wobble is far from the
cutoff. **A decision inside the wobble band should not be automated** — route it
to a person.

Cutoffs are **per rule, never shared.** Same-shaped questions have been measured
answering their own defect class anywhere between 0.20 and 0.94. The quiet ones
are not broken; they never reach a common threshold.

### Three traps that have all been hit here

- **An easy corpus.** The first version of this corpus had clean cases that were
  all trivially clean, topping out at 0.36 against a defect band starting at
  0.92 — so a cutoff of 0.61 looked safe by a wide margin, until the first
  unseen function produced a false positive at 0.69. **A hole for a class the
  corpus does not contain is invisible from inside the corpus.** Put the *hard*
  clean cases in: the vague-but-true comment, the conventional counter name, the
  entry point named for its directory.
- **Marker contamination.** `// CLEAN:` and `// DEFECT:` markers sitting above a
  declaration are read as doc comments by the comment rules, so those rules can
  only be calibrated on files where the marker sits above a *real* doc comment.
  Any rule whose subject includes comments has this problem.
- **A wrong domain model looks like a bad question.** Splitting one test rule
  into two made the numbers *worse* (1.0/1.0 → 0.5/0.5). The cause was not the
  wording: the two failure modes are **nested, not disjoint** — a test that
  exercises the wrong case also fails to establish its name. Relabelling fixed
  it. When a split makes things worse, suspect the labels before the sentence.

### Refit whenever the question changes

The cutoff belongs to a *configuration*, not to a rule. Changing the batching
axis (`--group`) or the `state` arm changes the question, so the cutoff has to be
refitted — on this corpus, switching to the rule axis makes one rule
(`fn-name-promises-rust`) stop separating at **any** cutoff, because a rule-axis
state spans files and cannot carry one. Pin a calibrated rule with `axis: file`.

## Building the evaluation loop

The loop that keeps a rule honest, in order. Skipping step 5 is how a rule
reaches production with a cutoff fitted to a corpus that flattered it.

1. **State the do-nothing baseline.** On an imbalanced set it has to be stated:
   a tool reporting nothing scored 79.9% accuracy on this corpus. Report
   precision and recall with the true-positive/false-positive/miss counts, never
   accuracy alone.
2. **Write the rule to over-match, and confirm it fired.** `jevlint rules`, then
   the "matched nothing" line.
3. **`gaps` first, on the labeled corpus.** Act on the verdict. `rewrite` sends
   you back to the subject, not to the thesaurus.
4. **`calibrate --repeat 3 --labels --record`.** Read the fit AND the gap AND
   the decision flips. All three.
5. **Re-run on code the corpus has never seen, and expect the clean band to be
   higher.** This is the step that finds the hole.
6. **Set the cutoff for headroom, not at the midpoint.** Where the gap is
   narrow, the midpoint is a coin flip on the next unseen sample.
7. **Average repeated passes when deciding anything near a cutoff.** Measured on
   1,378 real subjects: pass-to-pass spread is a median of 0.010 and a p90 of
   0.050, but the maximum is 0.260 — so a single pass over-reports and
   under-reports different subjects, and a three-pass mean is the honest unit.
8. **Commit the record.** Then any later claim about that rule is checkable
   without an API key, and recalibrating cannot silently rewrite history.

### Judging the tool's output

Read every finding against the code before believing it. When jevlint was run on
its own source — 1,377 subjects, 65 requests, $0.043 — it produced 11 findings
of which **9 were real and 2 were wrong**, and the four worst bugs of that
exercise were found by *distrusting its own summary lines*, not by any rule it
ran. Both halves of that are the lesson.

When you disagree with a finding, the useful question is which of three things
it is:

1. **The rule is right and the code is wrong** — most often, in this
   experience. Fix the code.
2. **The rule is right and the *name* is wrong.** A test called "no batch
   exceeds the ceiling" whose body legitimately exempts one-subject batches is
   not a weak test; it is a name that overclaims. Fix the name.
3. **The rule is wrong.** Then say so in the corpus, not in your head: add the
   case as a labeled clean example and refit. A false positive that is not in
   the corpus will come back.

And do not chase the tail. Editing a file changes the `located` state for every
subject in it, so a fix can move unrelated verdicts in the same file. Fix what
you agree with, re-measure with a three-pass mean, and record the residue you
disagree with rather than iterating against noise.
