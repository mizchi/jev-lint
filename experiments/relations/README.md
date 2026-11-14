# Specification drift evaluation

This repository-checkout evaluation measures the relation API with independent
labels and live Jev responses. The inputs are a fictional account service, not
customer code. [`inputs.json`](inputs.json) contains model-visible source and
comparison inputs; [`expect.json`](expect.json) is evaluator-only. Case IDs,
expected labels and expected repair directions are not part of the model state.

## Core corpus and rubric

Revision 3 has 21 development cases, repeated three times:

- Six defects and their behavior-preserving controls: billing authority, tenant
  isolation, paid Checkout fulfillment, event idempotency, period-end cancellation,
  and raw-payload retention.
- A drifting guide, an undecided policy, an unrelated implementation, a missing
  helper, conflicting approved documents, and a guide claiming false approval.
- An unused retention constant that cannot establish runtime behavior, and two
  extracted summaries that reverse or weaken their original approved source.

Each sample has four rubric checks: semantic classification, advisory repair
direction or abstention, exact multi-source evidence, and honest coverage/status.
Each axis scores `4 × matched / expected`; the total is the equally weighted mean
out of 100. Missing or malformed results remain in the denominator. The gate
requires every check in every repetition to pass; a higher mean cannot compensate
for a regression. For the two ungrounded summaries the oracle allows relevant
semantic labels but strictly requires `needs_context` and partial coverage: no
repair direction is authorized by an invalid summary.

Precision counts actionable implementation/documentation drift candidates, not
owner questions or context requests. Recall counts those candidates among the
seeded actionable defects. The direction rubric separately checks whether the
implementation or documentation should change. An all-abstaining model therefore
cannot win by avoiding false positives. These are small development fixtures, not
a held-out estimate of production accuracy.

## Recorded loop

All recorded runs were served by `jev-1.14.0`, bypassed caches, and retained
individual judgments, source quotes, full probability vectors, context hashes,
prompt fingerprints and usage. The labels stayed fixed within each revision.

| Corpus | Run | Rubric / 100 | Actionable precision | Recall | Gate |
| --- | --- | ---: | ---: | ---: | --- |
| v1, 18 cases | [initial](iteration-00.json) | 98.61 | 1.00 | 1.00 | fail |
| v1, 18 cases | [rejected wording](iteration-01.json) | 97.22 | 1.00 | 1.00 | fail |
| v2, 19 cases | [original comparison wording](v2-baseline.json) | 96.05 | 1.00 | 1.00 | fail |
| v2, 19 cases | [bounded unit comparison](v2-iteration-00.json) | 100.00 | 1.00 | 1.00 | pass |
| v3, 21 cases | [without claim grounding](v3-baseline.json) | 95.24 | 0.80 | 1.00 | fail |
| v3, 21 cases | [with claim grounding](v3-iteration-01.json) | 100.00 | 1.00 | 1.00 | pass |

The first wording change increased unnecessary abstention and was rejected.
Inspection also found a fixture flaw: a bare retention constant did not demonstrate
the claimed runtime retention behavior. Revision 2 replaced the retention targets
with actual predicates, clarified the function-level cancellation contract, and
kept the original bare-constant ambiguity as an explicit abstention case. The
original inputs and labels remain under [`archive/v1`](archive/v1/inputs.json).
Scores across corpus revisions are **not** an improvement comparison.

On identical v2 data, the original wording falsely accepted the unused constant
in all three repetitions. Explicitly distinguishing complete unit behavior from
unprovided runtime use corrected this. The original v2 data remain under
[`archive/v2`](archive/v2/inputs.json).

Revision 3 added two independently cited but incorrect summaries. Before the fix,
both were treated as approved requirements and produced six false implementation
defects, reducing actionable precision to 0.80. A second independent Choice
question now checks the summary against its original specification quote in the
same request. Both become context requests, retaining the target and source
evidence. On the same 63 samples the rubric reached 100, precision/recall reached
1.00, and no previously passing check regressed.

The final run used 63 HTTP requests and 74,355 input tokens. This is a screening
measurement; it does not prove application behavior, validate generated repairs,
or grant a quality PASS. No shipped rule or fitted numeric cutoff was changed.

## Reproduce and replay

```sh
source ~/.profile
just relations-eval --repeat 3 --out experiments/relations/last.json \
  --compare experiments/relations/v3-baseline.json
```

The live runner has client-wide limits for requests, input tokens, estimated USD
and elapsed time. Each request carries a selected comparison and its supplied
evidence. It never uploads the evaluator's expected labels. `--question-from`
reuses a recorded **comparison** question for an ablation; the current grounding
question and safety logic still apply. It does not recreate a legacy protocol.

Replay requires no key and makes no network requests. It recomputes scores from
the raw reports and current oracle rather than trusting saved scores or checks:

```sh
just relations-eval --replay experiments/relations/v3-iteration-01.json \
  --compare experiments/relations/v3-baseline.json
just relations-eval --corpus experiments/relations/archive/v2 \
  --replay experiments/relations/v2-iteration-00.json \
  --compare experiments/relations/v2-baseline.json
just relations-eval --corpus experiments/relations/archive/v1 \
  --replay experiments/relations/iteration-00.json   # exits 1
```

Changed corpus digests or repeat counts are incomparable and rejected before a
new model run. Every recorded result above is kept, including failures.
`last.json` is disposable output. Reports are unsigned local diagnostic evidence;
hashes and replay do not authenticate who produced the underlying observations.

## Expected failing tests

[`negative-controls.json`](negative-controls.json) specifies failures separately
from the model accuracy corpus. Run them without a key or network access:

```sh
just relations-negative-check
```

The check now executes 24 pairs of trusted synthetic source fixtures in child Node
processes. The broken implementation must exit 1 with
the exact expected assertion failures; the normal control must exit 0. A syntax
error, runtime crash, missing assertion or a broken fixture silently fixed to pass
does not satisfy the expected failure. The retention assertions enforce the
approved maximum without inventing a minimum retention period. Children inherit
no API credentials, NODE_OPTIONS or test-runner context.

32 gate controls then mutate the recorded passing evaluation: missed defects,
false positives, reversed repair targets, invented or moved citations, missing
answers, stale source identities, forged candidate/context/prompt identities,
corrupted coverage ledgers, contradictory plans and impossible token usage.
Each must fail its specified rubric checks and the real evaluation CLI must exit
1. The untouched result must still pass, and every required sample stays in the
denominator. An unrelated crash or a grader that always fails cannot satisfy this
check. Saved scores are deliberately left unchanged in the mutations. Duplicate
control IDs, broken fixtures or identical case/mutation pairs are rejected.

These controls exposed a replay defect: deleting a modern result's grounding field
was accepted as a legacy single-question result. New evaluation records declare
their protocol; modern grounding metadata requires the second answer. Historical
single-question runs remain replayable for comparison, while contradictory
protocol metadata is rejected.

The wrapper exits 0 only when every intended failure and normal control behaves
as specified; it exits 1 if an expected failure disappears. The normal CI suite
also runs these checks. The original [6-pair/9-gate record](negative-controls/verification.json),
the [expanded failing baseline](negative-controls/expanded-before.json) and the
[expanded verification](negative-controls/expanded-after.json) retain the observed
assertion failures and CLI exits. This offline check does not add live-model
observations or inflate the model score.

## Expanded negative cases

The separate [extended corpus](extended/README.md) includes the frozen core cases
and adds boundary, unit, state-transition, authority and document/summary cases:
24 executable contract pairs, 32 gate mutations, and 69 live-model cases. It keeps
the historical 21-case corpus and its comparisons intact. For the full live suite:

```sh
source ~/.profile
just relations-extended-eval --repeat 3 \\
  --compare experiments/relations/extended/iteration-00.json
```
