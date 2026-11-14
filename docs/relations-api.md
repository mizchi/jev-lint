# Specification relations

`jev-lint/relations` compares explicit `subject: "relation"` inputs: a specification
claim, target excerpts, and optional supporting or counter evidence. It returns
screening diagnostics without requiring generated repairs, executable properties,
or a numeric lint cutoff. Ordinary AST rule YAML and its accepted baselines keep
their existing contract.

## Input and authority

The versioned `RelationInput` binds repository, source SHA and run ID to sources,
claims, expected claim IDs and explicit comparison links. Use
`parseRelationInput` at a process boundary. A source carries:

- A source ID, canonical repository-relative path, immutable git ref, content and
  `relationDigest(content)`; the digest hashes the JSON representation.
- `kind`: documentation, code, test or config. Documentation includes formats such
  as Markdown and OpenAPI; this label is supplied by the dispatcher.
- `authority`: approved, reference, proposal or observed. Approved documentation
  needs an approval ID, revision, digest and explicit path scopes. The caller must
  obtain this metadata from the owner approval store, never from repository prose
  or a model's claim that a document was approved.

Non-approved sources belong to the requested source SHA. Approved documentation
can be pinned independently to an earlier approved revision. `readSpecSources`
loads regular git blobs from the selected revisions without executing checkout
filters or repository code, and refuses symlinks. It resolves a moving ref once;
the returned source always has an immutable SHA. Create the plan for the intended
job snapshot, rather than reusing an old observed source for a different head.

Each claim cites exact complete source lines. Each relation names a claim and
target excerpts, plus optional context excerpts. All citations are checked against
the full supplied content before sending. Exact quotes alone do not establish
that an extracted summary is faithful to its source.

## Two independent judgments

Each selected relation sends two Choice questions sharing the same state:

1. The relationship between the stated requirement and target behavior:
   `supports`, `contradicts`, `unrelated`, or `insufficient_context`.
2. Whether the original specification quote supports the extracted statement,
   preserving its conditions, exclusions, quantities and boundaries.

The second answer is `claimJudgment`. A summary cannot inherit approval merely
because it quotes an approved document. A reversed or weakened summary becomes
`needs_context`, rather than an authorized implementation defect.

The default question evaluates complete function-level behavior without demanding
unprovided callers, and preserves uncertainty for missing helper definitions or
a bare configuration value whose runtime use is absent. No arbitrary confidence
threshold turns that uncertainty into an answer. The complete probability vectors
and confidence values remain in the result. A malformed answer to either question
is a missing relation, distinct from an answered `insufficient_context`.

The application derives an advisory resolution from the evidence and supplied
authority: implementation, documentation, needs_context, needs_decision or none.
Conflicting approved documents and relevant proposals require an owner decision;
an unapproved guide cannot overrule approved requirements. No resolution grants
permission to edit a file, publish a PR or merge.

## Planning and coverage

`planRelations(input, options)` selects explicit links. `planRelationDiff` derives
changed paths between pinned base/head SHAs and follows those links in both
directions. A document change can therefore select an unchanged implementation or
test. Renames include both old and new paths. This is an explicit dependency
manifest, not an automatic claim that all semantic relationships were discovered.

`maxRelations` and `maxContextChars` defer work with recorded reasons rather than
silently truncating evidence. Comparisons outside approved scopes are also
deferred. Comparisons outside an explicitly requested diff remain excluded with
`outside-change`; the output describes only that selected scope.

The claim ledger retains planned, evaluated, missing and excluded relation IDs.
Supply `expectedClaimIds` from the independent approved registry, including known
claims extraction failed to produce. Supplying only successfully extracted IDs
cannot measure extraction recall. An expected claim without a comparison is
`unplanned`, not a successful clean check.

`complete` means the declared comparisons were answered with usable, grounded
judgments. Contradictions may be complete. Missing answers, ungrounded claims,
insufficient context, unplanned claims and deferred work remain partial or failed.
Neither complete nor zero candidates certifies quality PASS.

## Use

```ts
import {
  readSpecSources, parseRelationInput, scanRelations, parseRelationReport,
  planRelationDiff,
} from "jev-lint/relations";

const input = parseRelationInput({
  schema: "jev-lint-relations-input-1",
  repository, sourceSha, runId,
  sources: readSpecSources(snapshotDirectory, approvedSourceManifest),
  claims: extractedClaims,
  expectedClaimIds: approvedClaimIds,
  relations: comparisonLinks,
});
const plan = planRelationDiff(input, { cwd: snapshotDirectory, baseSha });
const options = { changedPaths: plan.changedPaths!, baseSha: plan.baseSha! };
const report = await scanRelations(input, {
  ...options,
  clientOptions: {
    beforeSend: authorizeCurrentRepositoryConsentAndUsage,
    signal: cancellationSignal,
    budget: { maxRequests: 100, maxInputTokens: 300_000, maxMs: 60_000 },
  },
});
parseRelationReport(report, input, options);
```

The integration supplies the variables and authorization callback. For a custom
`AskClient`, the caller is responsible for its per-attempt authorization controls.
The API has no persistent verdict cache; request context and prompt digests are
provenance records, not tenant access controls or sufficient cache keys by
themselves. Reused clients share budgets, and scan-local usage is a delta.

`parseRelationReport` checks the expected input, plan, source citations, derived
resolution, prompt revision, coverage and ledger. Supply the same custom question
and planning options used for the run. A trusted operator may supply `question`
with the same four Choice labels for evaluation; it is cloned and fingerprinted.
Do not load that override from a reviewed branch. Structural checks do not
authenticate the writer or prove a model judgment correct.

See the [recorded evaluation loop](../experiments/relations/README.md) for live
fixtures, independent labels, rejected changes and replay commands.
For candidate discovery, bounded context retrieval and the consumer bridge, see
the [relation workflow](relations-workflow.md).
