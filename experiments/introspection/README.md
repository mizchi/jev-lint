# Initial rule selection evaluation

Inputs are project file trees and candidate catalog IDs. Oracle decisions live
in separate `expect.json` files. The model receives metadata paths and package
script/dependency names, plus actual catalog descriptions; it never receives case
IDs, labels, source bodies, package script commands or dependency versions.

The rubric has three checks per scenario/pass: exact starter selection,
strict evidence/report provenance, and configuration behavior. Only enabled
known catalog rules may appear in YAML, with shipped cutoffs/severities retained.
Conditional-only, uncertain or incomplete results cannot create a starter.
The gate requires every check and no regression against the compared run.

| corpus and record | scenarios × passes | score | result |
| --- | --- | --- | --- |
| initial `iteration-00.json` | 24 × 3 | 82.41 | deferred basic naming and enabled overlapping test checks |
| initial `iteration-01.json` | 24 × 3 | 94.44 | fixed starter semantics; module/test overlap still failed |
| initial `iteration-02.json` | 24 × 3 | 100 | no regressions |
| extended `extended/iteration-00.json` | 36 × 3 | 96.30 | exposed a method-rule overlap, including a full catalog scenario |
| extended `extended/iteration-01.json` | 36 × 3 | 100 | 324/324 rubric checks, no regressions |

All live runs used `jev-1.14.0`. The extended corpus retains the initial controls
and adds method/type/module/error cases, JavaScript comments, shell and SQL,
filename/script-name injection, and a 37-candidate complete-catalog scenario.
Across three passes, it checks 216 rule decisions. The extended cases were
frozen before evaluating that corpus; failed labels were not relabelled.
Each artifact retains the question, corpus digest, exact metadata, policy
identities, decisions, usage and omissions.

```sh
source ~/.profile
JEV_LINT_MODEL=jev-1.14.0 just introspection-eval \
  --corpus experiments/introspection/extended --repeat 3 \
  --compare experiments/introspection/extended/iteration-00.json \
  --out experiments/introspection/extended/iteration-01.json
pnpm run eval:introspection
```

CI replays the accepted extended record with no API key, requiring current
question and policy identities. Historical prompt comparisons use each record's
own question explicitly; replay does not test a new provider deployment.
This is a development corpus for a conservative startup policy, not a production
accuracy estimate or evidence that these inventories contain code defects.

Deterministic tests cover missing/invalid answers, tampered vectors/ledgers,
inventory limits, unavailable metadata, stale snapshots, mutable caller inputs,
exclusive writes and source/record protection. `pnpm test introspect` runs these
boundaries with fixture clients and no network.
