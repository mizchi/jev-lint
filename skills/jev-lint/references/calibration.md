# Calibration

A cutoff is fitted, not chosen. A rule is not "working" because its findings
look plausible; it is working when, on code you have labelled, its answers for
defects and its answers for clean code are separated by a gap, and the cutoff
sits in that gap with headroom. This file is how to establish that, and what
to do when it fails.

## Where the cases live

A rule is a directory, and its cases live beside it:

```
rules/<id>/
  rule.yml                 the rule, every language variant
  evals/
    cases/                 fixture code that reads like real code -- no markers
    labels.json            {"$default":"clean","cart.ts":[{"line":12,"label":"bad","rule":"<id>","window":0,"reason":"..."}]}
    baseline.json          the accepted run: answers, cutoffs, the rule's draft hash
    last.json              the last run, accepted or not
```

Paths in `labels.json` are relative to `cases/`. `window` says how loosely
the line is matched; `0` for one-per-line subjects, larger for a
`subject: enclosing` rule that reports at the top of the function.

## The commands

```bash
jev-lint eval rules/<id> --repeat 3        # ask 3 times; score at the SHIPPED cutoff; compare with the baseline
jev-lint eval rules/<id> --accept          # ...and make that run the baseline
jev-lint eval --replay                     # every rule, no requests: re-score baselines at current cutoffs
jev-lint gaps <dir>                        # a rule with no labels yet: does it separate at all?
jev-lint calibrate <dir> --labels <json> --repeat 3 --record run.json   # a fit outside the evals layout
jev-lint replay run.json --labels <json>   # re-score and re-fit a record, free
```

`eval` is the loop. It scores every case at the rule's shipped cutoff on the
mean of the passes — the question is "does the rule as shipped still get its
cases right", and a fitted cutoff would move the goalposts to wherever the
answers landed — and prints the fitted cutoff beside it for you to consider.
Against the baseline it names every case that was right and is now wrong.
`--replay` is the free regression gate: it re-scores each baseline at the
cutoffs as they are now and fails on a case that was right when the baseline
was accepted, or on a rule whose sentence, criteria, note, matcher, subject
or state changed since — those answers were to a different question. A
changed question means: run, read, accept.

`gaps` and `calibrate` are the same measurements over any directory and any
labels file, for a rule that has no evals yet; `replay` re-derives a
calibrate record with no key.

## Read the gap before you touch a threshold

`gaps` sorts each rule's answers and reports the largest step between
neighbours:

```
rule                      kind  matched reported cutoff median gap   suggest verdict
fn-name-promises          noul  26      6        0.67   0.10   0.55  0.65    works
```

| verdict | what to do |
| --- | --- |
| `works` | nothing. Any cutoff inside the gap gives the same answers. |
| `move` | set `at:` to `suggest`. The rule discriminates; the threshold is misplaced. |
| `rewrite` | the answers are not separated. **No cutoff helps.** First check whether the subject can show what it is being asked (`subject`, `state`); *then* rewrite the sentence and criteria. |
| `silent` | the matcher never fired. Loosen it — this is the only place a dead matcher is visible. |
| `thin` | under 6 matches. Not a pass. Add cases. |

**`gaps` is for a labelled corpus, not for your repository.** A gap needs two
classes. Real code is ~99.8% clean, so on real source `gaps` prints `rewrite`
for every rule that fires, which means nothing. On real code read the
per-rule **median** and the **headroom** — the distance from the highest
*clean* answer to the cutoff — which `replay` prints. Headroom under 0.1 is
the rule that will produce your next false positive.

## Labels

A labels file marks the defects; everything else is clean by default:

```json
{
  "$default": "clean",
  "src/cart.ts": [
    { "line": 21, "label": "bad", "rule": "fn-name-promises", "reason": "applyDiscount also saves the cart" },
    { "line": 40, "label": "clean", "rule": "fn-name-promises", "reason": "terse but accurate; the hard clean case" }
  ]
}
```

`label` is `bad` or `clean`. `line` is matched within a window of 3 by
default (`"window": n` widens it), because a rule with `subject: enclosing`
reports at the top of the function, not at the line you labelled. `rule` is
optional; without it the label applies to every rule at that line. A `bad`
label wins over a `clean` one covering the same lines.

Keep the reasons. "Code quality" has no referee, so a label is an argument;
carrying the argument lets someone disagree with one label instead of with
the aggregate, and the fitted cutoffs are fitted to these opinions.

Write the JSON by hand, and keep it out of the code. The jev-lint repository
once derived its labels from `// DEFECT (rule-id): reason` comments above
each case, which kept line numbers from drifting — and handed the model the
answer, since the comment sat inside the file it was shown (see the trap
below). Its labels now live in `corpus/labels.hand.json`; the line numbers
are a maintenance cost worth paying.

## Building the corpus

The corpus is the investment; the rules are cheap. Some rules of thumb, each
of them learned by getting it wrong:

- **Six or more matches per rule, both classes present.** `thin` is not a
  pass.
- **Put the hard clean cases in.** The first corpus behind the shipped packs
  had clean cases that were all trivially clean, topping out at 0.36 against a
  defect band starting at 0.92, so a cutoff of 0.61 looked safe until the
  first unseen function produced a false positive at 0.69. A hole for a class
  the corpus does not contain is invisible from inside the corpus. The
  vague-but-true comment, the conventional counter name, the entry point named
  for its directory — those go in.
- **Keep the labels out of the files.** A `// DEFECT: named seconds, holds
  milliseconds` line above a defect is inside the file that `located` sends
  and inside the subject of an `enclosing` rule: the model is handed the
  answer, and the fit measures the label, not the rule. The shipped corpus
  learned this the expensive way — six rules' fits fell when the markers
  came out, one of them the README's own example. Labels live in JSON, and a
  corpus file reads like real code.
- **When a change makes the numbers worse, suspect the labels before the
  sentence.** Splitting one test rule into two made precision and recall drop
  from 1.0/1.0 to 0.5/0.5. The wording was fine; the two failure modes were
  nested, not disjoint, and the labels assumed disjoint. Relabelling fixed it.

## The procedure

1. **State the do-nothing baseline.** On an imbalanced set it has to be
   said: a tool reporting nothing scored 83% accuracy on the shipped corpus.
   Report precision and recall with the tp/fp/fn counts, never accuracy alone.
2. **Confirm the matcher fired.** `jev-lint rules`, then `--dry-run`, then
   the "matched nothing" line on a real run.
3. **`gaps` on the labelled corpus.** Act on the verdict. `rewrite` sends you
   back to `subject`/`state`, not to a thesaurus.
4. **`calibrate --repeat 3 --labels --record`.** Read the fit *and* the gap
   *and* the decision flips. A wobbly score with a stable decision is the good
   case: the wobble is far from the cutoff. **A decision inside the wobble
   band should not be automated** — route it to a person.
5. **Run on code the corpus has never seen and expect the clean band to be
   higher.** This is the step that finds the hole. It can also come back
   lower for a case the corpus had near the cutoff: a corpus batches its
   clean cases beside defects, and one clean step measured 0.42 beside
   eight defects and 0.15 in an all-clean batch of real workflows. A clean
   case's corpus answer is an upper bound on its real-code answer, not an
   estimate of it.
6. **Set the cutoff for headroom, not at the midpoint,** where the gap is
   narrow. The midpoint of a narrow gap is a coin flip on the next sample.
7. **Write it into the rule as `at:`, and commit the record.** Then any later
   claim about the rule is checkable without a key, and recalibrating cannot
   silently rewrite history.

Cutoffs are **per rule, never shared.** Same-shaped questions have been
measured answering their own defect class anywhere between 0.20 and 0.94; the
quiet ones are not broken, they never reach a common threshold.

## Refit whenever the question changes

The cutoff belongs to a *configuration*, not to a rule id. Changing `ask`,
`criteria`, `note`, the matcher, `subject`, `state`, or the batching axis
(`--group`) changes the question, and the old cutoff is an opinion about a
question nobody asks any more. `replay --labels` makes the refit free if you
recorded the run — and it does not make it free if you did not, which is
why the record is step 7 and not optional. Pin a rule calibrated on the file
axis with `axis: file` so `--group auto` cannot move it.
