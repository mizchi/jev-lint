# Adoption feature evaluation

The fixed corpus has 34 cases: 20 acceptance cases, six file-selection cases,
four directive cases and four SARIF cases. Expectations are separate from inputs.
The evaluator also normalizes and exports the 207 already-recorded relation
judgments from the expanded specification corpus. It makes zero model requests;
this measures the new deterministic infrastructure, not new model accuracy.

| Run | Equal-weight rubric / 100 | Gate |
| --- | ---: | --- |
| [Initial](iteration-00.json) | 91.43 | fail |
| [After fixes](iteration-01.json) | 100.00 | pass, no regression |

Each rubric has its own applicable denominator. The final results are
classification 20/20, mutation safety 16/16, real CLI behavior 16/16, file scope
6/6, directives 4/4, SARIF 4/4 and recorded relation adaptation 207/207.
The gate requires every applicable check to pass, independently of the mean.
`pnpm run ci` and the no-key GitHub Actions job run this evaluator after the
shipped-rule replay, so these cases also guard subsequent changes.

The initial failures exposed two defects. A clean duplicate could consume the
accepted allowance before a still-reported copy, incorrectly resolving and
pruning the surviving issue. A backtick inside an ordinary quoted string could
mask later directive warnings. Both were reproduced in unit tests and fixed
without changing the corpus/oracle digest. An additional empty-repository
regression test prevents a spurious git ignore-query failure.

Negative controls include missing model answers, omitted candidates, partial
processing, forged completion/evidence, incompatible scope, changed models,
policies/cutoffs/contexts and missing immutable deployment identity. Incomplete
capture/prune attempts must throw, actual CLI comparisons check exit codes and
JSON, and absent subjects cannot disappear from the acceptance ledger.

```sh
just adoption-build
just adoption-eval --out experiments/adoption/iteration-01.json \
  --compare experiments/adoption/iteration-00.json \
  --sarif-out /tmp/jev-adoption-exports.sarif
```

The 211 exported SARIF runs (four corpus cases plus 207 recorded judgments) were
validated against the OASIS SARIF 2.1.0 JSON schema, including URI format checks,
using Python jsonschema 4.26.0 outside the package's runtime dependencies.
The [validation receipt](sarif-validation.json) records the schema/document
SHA-256 digests, validator version and corpus identity.
The schema is available at
<https://github.com/oasis-tcs/sarif-spec/blob/main/sarif-2.1/schema/sarif-schema-2.1.0.json>.
The validator is an independent verification step; `adoption-eval` itself checks
the exporter behavior without a JSON-schema runtime dependency.

Upstream design references and the retained MIT notice are listed in
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). The fixtures here are
synthetic jev-lint inputs, not an imported third-party rule pack.
