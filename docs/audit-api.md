# Screening API and audit records

`jev-lint/audit` exports `scan`, `buildScanResult`, `parseScanResult`, and the
`ScanResultV1` types. `jev-lint/scan-contract` is the standalone process-boundary
contract: it imports no scanner, file-system runner, YAML parser, or network
client. Its only runtime import is Node's crypto implementation.

## CLI

```sh
jev-lint scan src --no-config --cache none \
  --repository owner/project --run-id run-00001 --namespace account-001 \
  --policy-ref <approved-commit-sha> > scan.json
```

`scan` writes one JSON document. Exit `0` means the selected scope was completely
processed, including when it produced candidates. Exit `3` means partial or
failed processing; exit `2` is invalid configuration or source provenance.
It does not certify that a repository is correct or authorize a merge.

The default scan cache is disabled. An explicit cache path must be outside the
source checkout and requires `--model-revision <immutable-deployment-id>`.
`--source-sha` defaults to HEAD; `--max-candidates` limits the output and records
omissions as a partial scan. `--dry-run` also produces a partial scan, since no
new verdicts were obtained.

The source checkout must be clean, at the requested SHA, and owned by the trusted
dispatcher. Make it read-only while a scan is running. The API checks the
checkout before and after processing; these checks are not a sandbox against
another process that can mutate and restore files between checks. Do not install
dependencies, run lifecycle scripts, or load branch-controlled parser libraries
in this runner. Supply trusted rules explicitly to the API. CLI users should
also supply trusted configuration or use `--no-config` with packaged rules.

## Programmatic use

```ts
import { scan } from "jev-lint/audit";
import { Jev } from "jev-lint/client";

const client = new Jev({
  beforeSend: async () => {
    await authorizeRepositoryAccess();
    await checkCurrentConsentAndReservation();
  },
  signal: cancellationSignal,
  budget: { maxRequests: 20, maxInputTokens: 200_000, maxMs: 60_000 },
});
const result = await scan({
  cwd: snapshotDirectory,
  rules: approvedRules,
  paths: ["src"],
  client,
  policyRef: approvedPolicySha,
  identity: { repository: "owner/project", sourceSha, runId },
  namespace: accountId,
});
```

These variables and authorization functions are supplied by the integration.
Credentials stay in the environment. The client has no PR-writing capability.
`beforeSend` runs before **each transport attempt**, including retries and split
requests, after pacing. A rejected authorization prevents sending. Cancellation
interrupts pacing, authorization, transport, and retry waits. A custom `AskClient`
must implement its own outbound controls and supply `endpointIdentity` to `scan`.

Budgets are client-wide. Request count, estimated input tokens and estimated cost
are reserved synchronously before awaiting authorization, so concurrent requests
cannot all reserve the same allowance. Known token usage corrects the reservation
after a response; a larger-than-estimated request can exceed the estimate before
the actual count arrives, and prevents further requests. These controls are not a
provider-side spending cap. Failed attempts retain their estimate. `usage` in a
scan records the successful calls and provider-reported token cost for that scan;
it is not a billing ledger for failed or unmetered requests.

## What the contract carries

- The repository, immutable source SHA, dispatcher run ID and selected policy
  SHA/digest. `policyRef` pins change-review instruction documents, including
  staged reviews, independently of instructions edited in the change itself.
  Trusted rule definitions and their `context:` documents remain caller inputs.
  Hosted scans disregard branch-controlled suppression comments by default;
  only a trusted caller can opt into `honorSuppressions`. Ordinary lint commands
  keep honoring suppression comments.
- Every answered subject, including those below a reporting threshold, with a
  content-derived candidate ID, rule fingerprint, source line range and matcher
  byte offsets where available, hash of the
  supplied subject text, that text as evidence, raw judgment, cutoff and request
  context digest. Retracted findings have their own disposition.
- Missing answers, omitted candidates, excluded paths, suppressions, unavailable
  language parsers, unpaired subjects, truncated input and degraded batches.
  `complete` describes only the declared scope; no matches is not proof that the
  matcher covered every defect.
- Fixed error codes and scan-local usage. Raw transport error messages are kept
  out of the boundary artifact.

The parser checks shape, canonical repository-relative source paths, ranges,
coverage counts, evidence hashes, cutoff/disposition agreement and consistency
of the status. A structurally valid artifact is still untrusted until its origin,
repository, head and approved policy are checked by the receiving application.
See [SECURITY.md](../SECURITY.md).

## Strict cache

`scan` uses the strict cache path in `run`. It hashes the complete planned state
and question set, subject ID, question schema, tenant namespace, repository,
endpoint, model identity and approved policy digest. A batch is reused only when
every answer is usable. A partial cache hit re-asks the same full batch rather
than silently changing its context.

Persistent scans require an explicit immutable `modelRevision`; a moving model
alias cannot identify a provider deployment. Cache files must be stored in a
tenant-isolated service-owned directory. A namespace separates keys; it is not a
file-access control. The existing CLI verdict cache remains available for ordinary
linting and retains its documented content/context tradeoffs.

## Independent consumers

Consumers can depend on `jev-lint/scan-contract` or vendor the standalone source
when they cannot take runtime dependencies:

```sh
just export-scan-contract /path/to/consumer/scan-contract.ts
just export-scan-contract /path/to/consumer/scan-contract.ts --check
```

Preserve this package's MIT license with a vendored copy. A gate receiving only a
screening artifact should preserve an unreviewed state, validate evidence against
the actual diff, and keep its deterministic decision independent of the model.

## Adversarial evaluation

`just adversarial-eval --repeat 3 --out /path/to/report.json` runs the existing
`typescript/fn-name-promises` rule against paired control and injected sources.
Each sample gets a fresh temporary git snapshot and bypasses the cache. Case
labels stay outside the model input. The output retains each scan and reports
control errors, attack errors, induced misses, induced false positives and missing
answers separately.

`jev-lint/adversarial` also accepts an optional detailed-review callback and
reports how many induced misses it recovers. A callback that was not executed
has no recovery rate. Offline tests use explicit doubles to verify accounting;
they make no claim about live-model resistance. No accepted rule baseline or
fitted cutoff is changed by this evaluation.
