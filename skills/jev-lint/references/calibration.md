# Calibration

A cutoff is fitted, not chosen. A rule is not "working" because its findings
look plausible; it is working when, on code you have labelled, its answers for
defects and its answers for clean code are separated by a gap, and the cutoff
sits in that gap with headroom. This file is how to establish that, and what
to do when it fails.

## The three commands

```bash
jev-lint gaps corpus                                          # does the rule separate at all?
jev-lint calibrate corpus --labels labels.json --repeat 3 --record run.json
jev-lint replay run.json --labels labels.json                 # re-score and re-fit, free, forever
```

`gaps` needs no labels and asks the first question. `calibrate` fits a cutoff
per rule against labels and, with `--repeat`, reports which subjects changed
*decision* between passes. `replay` re-derives everything from the record
with no API key, so a cutoff stays a checkable claim rather than a number
someone once saw.

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

The jev-lint repository derives its labels from comments in the corpus
(`// DEFECT (rule-id): reason`, `// CLEAN: reason`) with
`corpus/build-labels.ts`, so line numbers cannot drift when a file is edited.
Copy that script if your corpus will live long; write the JSON by hand for a
first fit.

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
- **Do not let markers contaminate the subject.** A `// CLEAN:` comment
  sitting directly above a declaration is read as its doc comment by a
  comment rule. Any rule whose subject includes comments can only be
  calibrated on files where the marker sits above a *real* comment, or the
  labels live in JSON.
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
   higher.** This is the step that finds the hole.
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
