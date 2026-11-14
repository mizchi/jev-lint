# Document consistency evaluation

`inputs.json` contains 32 comparisons. `expect.json` is the separate oracle:
14 contradictions, 16 compatible controls, one insufficient-context case and one
unrelated pair. The model receives only neutral source IDs, the declared topic,
mode and quoted texts. It does not receive case IDs or expected labels.

Cases cover current versus historical numbers, English/Japanese translations,
cache versus acceptance terminology, completion versus quality PASS, provenance,
command modes, explicit exceptions and instructions embedded in document text.
The final-stage case requires distinguishing an exhaustive pipeline claim from
a compatible partial list. Cases and labels were frozen before the first run.

The rubric has three binary checks per case/pass: exact semantic choice,
strict report/evidence integrity, and coverage/status/exit-code correctness.
The gate requires every check to pass. The score is the percentage of checks
passed; it is not a precision estimate for arbitrary production documentation.

| record | question | cases × passes | rubric checks | score | regressions |
| --- | --- | --- | --- | --- | --- |
| `iteration-00.json` | initial scope/translation/terminology instructions | 32 × 3 | 288/288 | 100 | — |
| `iteration-01.json` | explicit exhaustive-list and final-stage semantics | 32 × 3 | 288/288 | 100 | 0 |

Both live runs used `jev-1.14.0`. Each artifact contains the question, corpus
digest, all evidence-bound answers and measured usage. Comparison re-scores the
old question against the same frozen corpus. CI replay additionally requires
the current question to match the accepted evaluation question.

```sh
source ~/.profile
JEV_LINT_MODEL=jev-1.14.0 just docs-eval --repeat 3 --out experiments/documents/iteration-00.json
JEV_LINT_MODEL=jev-1.14.0 just docs-eval --repeat 3 \
  --compare experiments/documents/iteration-00.json \
  --out experiments/documents/iteration-01.json
pnpm run eval:documents
```

`self-before.json` records the first full self-check: 18/18 comparisons answered,
with five contradictions in the English/Japanese catalog counts, reference
count, architecture CI sequence and shipped-rule baseline requirements. These
are stale excerpts retained as historical evidence; current snapshot replay
must reject them. The corrected working-tree snapshot is recorded separately
in `.jev-lint/documents-baseline.json`.

Deterministic failure-path tests also reject forged quotes, altered question or
candidate identity, malformed probabilities and counters, missing/deferred
comparisons, ambiguous selectors, symlink sources, unregistered documents,
unbound documents, revoked sends and edits during a run. Run `pnpm test document`
for these boundaries. Fixture API responses are synthetic and never call a model.
