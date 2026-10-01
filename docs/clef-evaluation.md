# Evaluating Clef as the verdict model

Jev remains the recommended model for normal linting. Its accepted records
performed best at the shipped thresholds in the comparison below. Clef and
Clef-flash are optional experimental candidates, available through this
repository's comparison tool; the packaged lint commands continue to use Jev.

`just clef-eval` compares Cloudflare's Clef and Clef-flash with the accepted
Jev answers, using each rule's existing fixtures, labels, question and state.
The report measures the effect of replacing the model at the current shipped
thresholds. A separate refit diagnoses how much a change in score scale explains
the difference.

## API compatibility

Cloudflare describes Clef as System One API compatible in its
[announcement](https://blog.cloudflare.com/clef-decision-models/). The
[Clef specification](https://developers.cloudflare.com/workers-ai/models/clef/)
and [Clef-flash specification](https://developers.cloudflare.com/workers-ai/models/clef-flash/)
use the same `state`, `questions`, `noul`, `score`, and `choice` fields that
jev-lint sends. Their instruction and criterion fields accept structured data.

The Workers AI endpoint needs an account ID and a Cloudflare bearer token, and
its REST response wraps the result. Clef also accepts at most 64 questions per
request. The adapter unwraps that response and splits larger question sets
before sending them. Every split resends the same state and retains the
original question IDs; that extra input counts toward cost.

Prices checked on 2026-10-02, per million input tokens:

| Model | USD / million input tokens |
| --- | ---: |
| Jev | 0.042 |
| Clef | 0.24 |
| Clef-flash | 0.09 |

Jev's price is also published in
[TypeSafe's announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev).
The Clef prices come from the model specifications linked above. The measured
cost uses successful responses' token usage; the dry run uses jev-lint's
existing estimator, which has not been fitted to Clef's tokenizer.

## Run the comparison

Plan without API calls or result files:

```sh
just clef-plan
just clef-plan --rules rules/typescript/fn-name-promises
```

Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the environment.
`CLOUDFLARE_AUTH_TOKEN` is also accepted. Then start with a small suite:

```sh
just clef-eval --rules rules/typescript/fn-name-promises
just clef-eval
```

If the credentials are in a local `.env`, load them with Node:

```sh
node --env-file=.env tools/compare-models.ts --out experiments/clef/full
```

Each candidate gets three passes by default, with four concurrent batches.
The candidates use a conservative initial token pacing budget and retain
Jev's retry and rate-limit handling. These defaults are experiment settings;
they are not measured Cloudflare throughput limits.

To sample Jev again in the same run, set `TYPESAFE_API_KEY` (or
`TYPESAFEAI_API_KEY`) and use:

```sh
just clef-plan --live-jev
just clef-eval --live-jev
```

The provider order rotates between suites. `--live-jev` measures the current
complete pipeline, including each provider's batching, network time and pacing.
The historical baselines may contain older fixture contents and were taken
under different runtime conditions. Their matching rule drafts establish the
question, but their recorded timings are not a controlled latency comparison.

Useful options are `--models clef-flash`, `--repeat 5`, `--concurrency 8`,
`--rules dir,...`, and `--out path`. Custom-language suites require parser
declarations through `--config`; the default run lists suites it skips.

## Read and replay the results

Results go to `experiments/clef/` by default:

- `records/<model>/<language>/<rule>.json` preserves every pass in the existing
  eval record format. The Jev record is copied from the accepted baseline or
  sampled with `--live-jev`.
- `manifest.json` records the selected suites, requested models and Jev's provenance.
- `report.json` contains the comparison, per-rule scores, fitted thresholds,
  changed decisions, token usage, cost and wall time.
- `report.md` renders precision, recall, F1, false positives, false negatives,
  pass-to-pass flips, missing answers, cost and wall time beside the refit.

Replay without credentials or API calls:

```sh
just clef-replay
node tools/compare-models.ts --replay --json --out experiments/clef
```

Replay uses the original suite and candidate selection from the manifest;
explicit `--rules` and `--models` options can narrow it.

Both models are scored on the same fully answered labelled locations, identified
by rule, file and line, as in the existing eval scorer. If a matcher selects
multiple nodes on one line, both records must contain that many valid samples
on every pass. Their values are pooled at that labelled location. Missing or
invalid answers are counted separately and make the comparison incomplete;
stale rule drafts and unavailable records are errors.
If a live suite yields no usable answers, subsequent inference stops and the
report is incomplete, so an account refusal is not repeated for every suite.

Scores use the existing eval's raw per-pass rule answers. Request counts, cost
and time also include the instruction-attribution follow-up for change rules;
its final retractions are not part of the raw-answer accuracy score.

Exit 0 means a complete comparison, 2 means an invalid setup or record, and 3
means incomplete answers. Regressions remain visible in the report; this
experiment's exit code does not require a candidate to beat Jev.

The refit is fitted and scored on these same fixtures. It is a diagnostic of
threshold shifts, not held-out accuracy. A deployment decision should inspect
the per-rule changes and verify any chosen cutoff on separate labelled code.

## Initial plan, 2026-10-02

`node tools/compare-models.ts --dry-run --json` planned 81 suites and 1,748
matched subjects, three passes each. Twenty MoonBit and two Vibe suites require
parser configuration. The planned Clef request counts include the 64-question
limit and repeated state:

| Candidate | Requests | Estimated input tokens | Estimated USD |
| --- | ---: | ---: | ---: |
| Clef | 1,395 | 5,227,086 | 1.2545 |
| Clef-flash | 1,395 | 5,227,086 | 0.4704 |

Re-scoring those 81 suites' accepted Jev records at today's shipped cutoffs
yields 592 true positives, 4 false positives, 18 false negatives and 1,133 true
negatives over 1,747 labelled locations (precision 0.9933, recall 0.9705). There
is one location with two selected nodes, which explains the difference from
the plan's matched-subject count. These are historical Jev results.

## Live results, 2026-10-02

The live run used `.env` with the command above, 81 suites, 1,747 labelled
locations, three passes per candidate and concurrency four. All 162 candidate
suite runs completed without missing answers. Jev uses the accepted historical
`jev-1.13.0` records, which contain three or five passes depending on the suite.
MoonBit and Vibe's 22 suites were skipped because their parsers were not configured.

At the shipped thresholds:

| Model | Precision | Recall | F1 | False positives | False negatives |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jev | 99.33% | 97.05% | 98.18% | 4 | 18 |
| Clef | 94.89% | 94.43% | 94.66% | 31 | 34 |
| Clef-flash | 85.56% | 63.11% | 72.64% | 65 | 225 |

Refitting and scoring on the same fixtures gives F1 98.94% for Jev, 98.04% for
Clef and 86.24% for Clef-flash. Clef's refit has 13 false positives and 11 false
negatives. These are diagnostic fits, not held-out results. Clef therefore needs
rule-specific threshold calibration before a replacement; Flash's separation
of defects from clean code is weaker even after fitting thresholds.

Clef used 4,242,681 input tokens in 1,399 successful requests, equivalent to
$1.018243 at the documented input price. Flash used 4,239,371 tokens in 1,396
requests, equivalent to $0.381543. Both candidates had zero decision flips over
their repeated samples.

The cumulative request phases took 1,430.5 seconds for Clef and 1,518.0 seconds
for Flash; the whole run took 49.3 minutes. API response times varied widely.
A separate short request during the run timed out after 15 seconds on Clef;
Flash answered a 154-token request in 8.49 seconds. These observations include
API waiting and do not establish isolated model inference latency or a controlled
speed comparison against historical Jev.

The live run's raw records, manifest and detailed report were saved locally
under `experiments/clef/full/`, which is ignored by Git. Replay reproduced all
162 comparison scores exactly without API calls. The aggregate counts above
are sums of the per-suite confusion matrices in `report.json`. After running
the comparison, replay its saved records with:

```sh
node tools/compare-models.ts --replay --out experiments/clef/full --json
```
