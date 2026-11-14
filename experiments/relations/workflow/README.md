# Repository workflow evaluation

Twelve synthetic repository changes exercise discovery, bounded context retrieval,
semantic judgments, coverage and the actual watchpoint relation importer. Each
case creates deterministic base/head git snapshots; only the specification changes,
so an unchanged implementation must be found through its relationship. An
unrelated function is also present. No fixture code or package scripts execute.

The cases include direct role checks, equivalent refactoring, correct and incorrect
unit conversion through a renamed import, missing/ambiguous modules, exhausted
context budgets, two dependency hops, a first-line module constant, a missing
registry claim and an approved scope mismatch. Input fixtures and oracle labels
are separate. Model inputs contain neither case IDs nor oracle expectations.

| Run | Samples | Rubric / 100 | Result |
| --- | ---: | ---: | --- |
| [Initial](iteration-00.json) | 36 | 95.37 | Two alias-binding judgments and all three module-constant judgments remained unresolved |
| [After retrieval fixes](iteration-01.json) | 36 | 100.00 | All six axes pass for all samples |

The initial catalog used ast-grep's zero-based matcher lines as complete source
line numbers, losing the declaration on line one. Retrieval also detached an
imported helper from the import declaration that binds its alias. Both defects
were reproduced in regression tests, then fixed without changing the frozen
case/oracle digest or model questions. Live runs use `jev-1.14.0` without a cache.

The rubric checks target retrieval, semantic classification, repair direction,
report provenance, honest missing coverage and the real consumer's UNREVIEWED
result. Replay reconstructs the snapshots and current retrieval workflow, and
re-runs the consumer without model requests. Failed or altered records are
re-scored; their stored pass flags are never reused. These are development
regressions, not a held-out production accuracy estimate or an end-to-end test of
automatic claim extraction. The registry and extracted claims are supplied.

```sh
just relations-workflow-build
source ~/.profile
just relations-workflow-eval --repeat 3 --watchpoint ../watchpoint
just relations-workflow-eval --replay experiments/relations/workflow/iteration-01.json
```

The watchpoint checkout is trusted consumer code chosen by the operator.
Source-containing records remain local/private in a service deployment.
