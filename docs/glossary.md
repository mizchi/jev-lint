# Terms used in jev-lint documentation

These definitions describe the current interfaces. An explicitly dated experiment
or older release can describe different behavior without contradicting them.

## Baselines and caches

A verdict cache stores reusable model answers. The ordinary CLI cache is
`.jev-lint/baseline.json`; the strict audit cache also binds the entire request,
tenant, repository, endpoint, model deployment and selected policy. Cache reuse
is not an owner approval or a quality verdict. The relation API has no persistent
verdict cache.

A rule evaluation baseline is `rules/<language>/<id>/baseline.json`. It records
accepted fixture answers and question identity for calibration/replay. It does
not accept findings in a user's project.

An accepted-findings baseline is a separate ledger, normally
`.jev-lint/accepted-findings.json`. It records explicit acceptance and counts;
changed model, policy or context requires rechecking. Missing or unobserved
subjects are not evidence of resolution. Acceptance never skips a model request.

The documentation record `.jev-lint/documents-baseline.json` contains recorded
comparisons for a content-digested documentation snapshot. Replay validates the
current snapshot and question identity; it does not produce a fresh model answer.

The Japanese terms 回答キャッシュ, ルール評価のbaseline, 指摘の受入台帳 and 文書比較の記録
name these respective concepts. Different translations are acceptable when the
same distinctions remain explicit.

## Completion and quality

`complete` describes processing of the declared scope. A completed relation or
document comparison can contain contradictions. Zero candidates is not proof
that every possible defect was examined. Missing answers, relevant insufficient
context and deferred work remain visible.

`UNREVIEWED` means screening has not completed an independent quality review.
A finding is a candidate for review, not permission to modify, approve or merge.
Successful SARIF execution also does not imply quality PASS.

In Japanese, 処理完了 or 比較完了 can translate scope completion; 品質合格 means a
different assertion and cannot replace it.

## Model identity

The default model is distinct from the explicitly selected model. An immutable
deployment identity used for persistent audit cache/acceptance cannot be inferred
from a moving alias. A recorded response's served model describes that run;
replay does not test a new provider deployment.

## Evidence and snapshots

Audit scan and relation source revisions are immutable git commits. A context
hash identifies the supplied request evidence; it is not a tenant access control
or an authenticated writer identity. Approval metadata comes from the owner
store, not from claims embedded in reviewed text.

Documentation checking can read a working tree. Such a snapshot uses content
digests and exact quoted ranges; its digest is not represented as a git commit.
An old document's line range must retain its old revision rather than being
presented as a current-head physical location.
