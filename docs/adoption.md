# Accepting findings and exporting reviews

These operations do not call a model or turn screening into a quality PASS.
The accepted-findings ledger is separate from the verdict cache at
`.jev-lint/baseline.json` and from calibrated rule fixture baselines.

## Accepted findings

Produce a [scan artifact](audit-api.md), then explicitly accept the current
findings with the operator's scope and immutable deployment identity:

```sh
jev-lint baseline write --artifact scan.json \
  --baseline .jev-lint/accepted-findings.json \
  --scope-id billing-contract --model-revision deployment-001

jev-lint baseline compare --artifact next-scan.json \
  --baseline .jev-lint/accepted-findings.json \
  --scope-id billing-contract --model-revision deployment-001

jev-lint baseline prune --artifact next-scan.json \
  --baseline .jev-lint/accepted-findings.json \
  --scope-id billing-contract --model-revision deployment-001
```

The ledger retains the accepting artifact digest, source SHA, run ID and
deployment identity. It stores fingerprints/counts rather than source quotes.
`write` is an explicit acceptance operation: use the owner approval store in a
hosted integration. Never let PR-controlled configuration accept its own findings.
`compare` is read-only and does not skip any model requests upstream.

Continuity keys track a scan's rule, path and exact subject text without line
numbers. Counts distinguish duplicate copies. Relation continuity uses the claim
ID, relation ID and target paths; callers should supply stable logical relation
IDs. Automatically discovered IDs can change when source ranges change.

An independent fingerprint binds the whole judged context, rule/cutoff, policy,
model and deployment identity. A matching finding is `accepted`; a new copy is
`new`; changed judgment inputs under the same continuity key are `recheck`.
Line movement alone does not change the continuity key, but a changed full request
context still requires rechecking. This is deliberately stricter than a line-only
suppression. Significant whitespace inside evidence is never normalized away.

`resolved` requires an explicit usable clean answer with the same acceptance
fingerprint. Missing answers, absent subjects, changed-context clean answers and
comparisons outside the observed set remain `unassessed`. A rewritten or removed
subject is not automatically proof that its defect was fixed. Its old ledger
entry remains until the operator replaces the accepted set. `prune` removes only
explicit resolutions, never adds entries, and refuses incomplete reviews.

Exact still-reported copies consume their allowance before clean duplicates, so
input order cannot accidentally prune a surviving finding. `write` and `prune`
validate before an atomic file replacement; they refuse known verdict-cache and
rule-baseline paths, and do not overwrite a file of another schema.

`compare` exits 1 for new/recheck findings, 3 for incomplete processing, and 0 when
the assessed scope has no new/recheck findings. Unobserved old entries stay in the
output even when that selected-scope comparison exits 0. The output always keeps
`qualityVerdict: "UNREVIEWED"`. Exit 2 is invalid input/configuration. A deployment
identity is required even for an offline CLI comparison; it is supplied by the
operator, not inferred from a moving model alias.

For relations, pass `--relation-input final-input.json` from the trusted dispatcher.
If the producer used a diff or planning budget, also pass
`--relation-options trusted-plan-options.json` with its `changedPaths`, `baseSha`,
`maxRelations` and/or `maxContextChars`. The existing report validator checks the
expected input/plan, source quotations and coverage. Unresolved owner decisions
remain unassessed and cannot be accepted as a complete review.

## File scope and doctor

```sh
jev-lint check src --explain-scope --json
jev-lint review --base main --explain-scope --json
jev-lint doctor --json
```

The scope report inventories eligible files, user/git ignores, unchanged paths,
missing parsers, absent applicable rules, unsupported extensions, hidden entries
and symlinks. Pruned directories are counted separately; their unvisited files
are not invented in the file counts. Unreadable paths, unavailable git ignore
queries and entry-budget exhaustion remain explicit issues. The default bound
is 10,000 visited entries. No AST matches or model requests are made.

This is **file eligibility**, not a promise that every eligible file yields a
subject. Use `--dry-run --show-subjects` for the actual matcher plan. The scope
report shares the existing directory/exclude policy, checks git ignores and
uses an explicit extension map; native ast-grep ignore files, filename overrides
or parser-specific selection can further narrow its matches. A complete scope
report describes the inventory, not semantic coverage or quality.

`doctor` checks Node's version floor, executable availability, declared parser
library presence and API-key presence. It never loads a custom parser, executes
the source checkout, contacts a provider or prints a credential value. It checks
availability, not the executable's actual version or provider connectivity.

Suppression comments now report unknown directive scopes and suggestions where
the spelling matches a known scope. A reason after ` -- ` is kept out of the rule
list. Multiline template/triple-quoted examples are not interpreted as directives.
This remains a conservative comment reader, not a complete lexer for every
language. Hosted scans retain their default of ignoring branch-controlled
suppression comments.

## SARIF

```sh
jev-lint check src --sarif > results.sarif
jev-lint review --base main --format sarif > results.sarif
jev-lint report --artifact scan.json --sarif --output results.sarif
jev-lint report --artifact relations.json --relation-input final-input.json \
  --relation-options trusted-plan-options.json --sarif --output relations.sarif
```

The exporter emits SARIF 2.1.0 with encoded repository-relative URIs and positive
line ranges. Incomplete reviews carry an unsuccessful execution and a fixed
notification instead of silently looking complete. No-verdict observations are
notes. The run's quality verdict remains UNREVIEWED even if execution succeeded.

Relation exports retain pinned related locations. Historical revisions are logical
locations with their SHA, so their old line ranges are not presented as current
head locations. A historical-only comparison can have no physical primary
location. Full source quotes are not embedded by the SARIF exporter, but finding
messages and file names can still be private; choose the destination accordingly.
Do not treat SARIF as the authenticated audit artifact or the watchpoint gate.

SARIF is available for check/review, scan and compatible replay results. Commit
subjects and plans require JSON because they are not current source locations.
All normalized review, acceptance, scope and SARIF APIs are also available through
the `jev-lint/review-artifact`, `/acceptance`, `/scope`, `/doctor`, and `/sarif`
package exports. Structural parsers do not authenticate the artifact's writer;
the integration must bind expected repository, snapshot, approval and access.

See the [evaluation record](../experiments/adoption/README.md) and
[upstream attribution](../THIRD_PARTY_NOTICES.md).
