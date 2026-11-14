# Discovering and completing specification comparisons

`jev-lint/relations` exports `indexRelationSources`, `discoverRelations`,
`expandRelationContext`, `screenRelationWorkflow`, and `parseRelationWorkflow`.
They extend the [explicit relation API](relations-api.md) without changing its
wire schema, source authority or two independent model questions.

## Discovery

The source catalog is built from the supplied, pinned `RelationInput.sources`.
TypeScript, TSX, JavaScript and JSX use the installed ast-grep binary with trusted
structural queries in a temporary directory. Repository parser configuration and
code are never loaded. Complete source lines identify functions, test bodies,
types and simple variable declarations. Other formats fall back to a complete
file excerpt; oversized excerpts and indexing failures remain recorded.

Discovery ranks excerpts by matching terms from the claim ID, statement and
optional operator-supplied terms. Camel-case identifiers are split. Named
containers are matched using their own contents, avoiding a match solely because
an unrelated function shares a file name. This is lexical retrieval, not a
semantic relevance guarantee. An alias can be supplied through `terms` for
domain vocabulary or languages the default tokenizer cannot connect.

Results retain proposed links, matched terms, missing registry claims, unmatched
claims, budget-deferred claims, out-of-scope excerpts and unavailable indexes.
Existing links and original claims remain unchanged. Only an independent owner
store can grant specification authority; discovering a comparison cannot do so.
Claim extraction is still a caller responsibility. The independent expected
claim registry must include known claims that extraction omitted.

## Bounded context retrieval

After a grounded comparison answers `insufficient_context`, the workflow searches
the catalog for same-file definitions and explicit relative named imports. It
supports import aliases and follows another dependency layer on the next round.
The import declaration itself is supplied with an imported body so the model can
verify the alias binding. Every addition is an exact quote from a pinned source.

Ambiguous module paths and duplicate same-name definitions are not guessed.
Dynamic imports, namespace/default imports, re-exports, computed dispatch and
non-JavaScript module resolution require caller-supplied context. The graph is
approximate; only the model evaluates whether the supplied behavior satisfies a
requirement. Retrieval does not execute code or add files outside the supplied
source catalog. Include permitted helper sources in the dispatcher manifest.

The default budgets are two retrieval rounds after the initial scan, 24,000 added
characters and 20 added excerpts across the workflow. There is also the relation
API's 20-context-excerpt limit per relation and its planned context-size limit.
No budget silently truncates an excerpt. Unresolved comparisons remain partial;
deferred discovery or context also keeps the workflow partial. Each round scans
the selected set again, so unchanged comparisons can incur another request.

## Use

```ts
import { screenRelationWorkflow, parseRelationWorkflow } from "jev-lint/relations";

const options = {
  baseSha,
  changedPaths,
  discovery: { maxCandidates: 100, maxCandidatesPerClaim: 3 },
  context: { maxRounds: 2, maxAddedChars: 24_000, maxExcerpts: 20 },
  clientOptions: {
    beforeSend: authorizeCurrentAccessConsentAndUsage,
    budget: { maxRequests: 100, maxInputTokens: 300_000, maxMs: 60_000 },
  },
};
const workflow = await screenRelationWorkflow(input, options);
await parseRelationWorkflow(workflow, input, options); // no model requests
```

Use `planRelationDiff` to derive the pinned `baseSha` and `changedPaths` as in the
explicit API. Discovery is opt-in; omitting `discovery` preserves explicit links.
Context retrieval remains bounded by the supplied catalog even when discovery
is disabled. `beforeSend` runs on every actual transport attempt, and one shared
client accounts for all rounds. Workflow `usage` sums every round; the final
relation report's usage describes its own scan only.

The result retains the final input/report, every round's exact input/report,
added context, stop reason and retrieval omissions. `parseRelationWorkflow`
reconstructs discovery and retrieval against the expected original input and
options, validates every report and rejects changed histories, totals and stop
reasons. Replay uses the installed retrieval implementation; a historical
retrieval algorithm may need its original producer revision. Structural replay
does not authenticate an artifact's writer or validate a model's semantics.

All results keep `qualityVerdict: "UNREVIEWED"`. A complete declared comparison
set is not a quality PASS. monet's Node runner accepts `discovery` and `context`,
returns the full workflow, and reauthorizes each send. watchpoint's
`quality import-relations` accepts the final relation report with its independently
supplied final input, checks every pinned source against git, and anchors advisory
findings to actual added lines. Unchanged linked evidence stays in its private
`relationEvidence` sidecar; it does not relax the ordinary diff evidence checks.

The [repository workflow evaluation](../experiments/relations/workflow/README.md)
records discovery, retrieval, model judgments and the real watchpoint importer.
