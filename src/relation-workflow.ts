import { Jev } from "./jev.ts";
import { isDeepStrictEqual } from "node:util";
import { scanRelations, type RelationsOptions } from "./relations.ts";
import { parseRelationReport } from "./relation-report.ts";
import { indexRelationSources, discoverRelations, type RelationCatalog, type RelationDiscovery, type RelationDiscoveryOptions } from "./relation-discovery.ts";
import { expandRelationContext, type RelationContextOptions, type RelationContextExpansion } from "./relation-context.ts";
import { parseRelationInput, type RelationInput, type RelationReport } from "./relation-contract.ts";

export interface RelationWorkflowOptions extends RelationsOptions {
  catalog?: RelationCatalog; discovery?: RelationDiscoveryOptions;
  context?: RelationContextOptions & { maxRounds?: number };
}
export interface RelationWorkflowResult {
  schema: "jev-lint-relation-workflow-1"; input: RelationInput; report: RelationReport;
  status: RelationReport["status"]; qualityVerdict: "UNREVIEWED"; discovery: RelationDiscovery | null;
  rounds: Array<{ input: RelationInput; report: RelationReport; added: RelationContextExpansion["added"] }>;
  contextDeferred: RelationContextExpansion["deferred"]; usage: RelationReport["usage"];
  stopReason: "answered" | "no-context" | "context-budget" | "round-budget" | "request-failed";
}

/** Discovery and retrieval remain screening. The final input is retained for independent replay. */
export async function screenRelationWorkflow(raw: RelationInput, options: RelationWorkflowOptions = {}): Promise<RelationWorkflowResult> {
  const client = options.client ?? new Jev(options.clientOptions);
  return runWorkflow(raw, options, (input) => scanRelations(input, { ...options, client }));
}

/** Reconstruct retrieval and coverage without making any model request. */
export async function parseRelationWorkflow(raw: unknown, input: RelationInput, options: RelationWorkflowOptions = {}): Promise<RelationWorkflowResult> {
  const fail = (): never => { throw new Error("invalid relation workflow"); };
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as RelationWorkflowResult).rounds)
    || (raw as RelationWorkflowResult).rounds.length > 11) return fail();
  const workflow = raw as RelationWorkflowResult; let index = 0;
  try {
    const rebuilt = await runWorkflow(input, options, async (expected) => {
      const round = workflow.rounds[index++];
      if (!round || !isDeepStrictEqual(round.input, expected)) return fail();
      return parseRelationReport(round.report, expected, options);
    });
    if (!isDeepStrictEqual(rebuilt, workflow)) return fail();
    return structuredClone(rebuilt);
  } catch { return fail(); }
}

async function runWorkflow(raw: RelationInput, options: RelationWorkflowOptions, scan: (input: RelationInput) => Promise<RelationReport>): Promise<RelationWorkflowResult> {
  let input = parseRelationInput(raw);
  const maxRounds = options.context?.maxRounds ?? 2, maxAddedChars = options.context?.maxAddedChars ?? 24000, maxExcerpts = options.context?.maxExcerpts ?? 20;
  if (![maxRounds, maxAddedChars, maxExcerpts].every((n) => Number.isSafeInteger(n) && n >= 0) || maxRounds > 10) throw new Error("invalid relation workflow budgets");
  const catalog = options.catalog ?? await indexRelationSources(input);
  const discovery = options.discovery === undefined ? null : discoverRelations(input, catalog, options.discovery);
  if (discovery) input = parseRelationInput({ ...input, relations: [...input.relations, ...discovery.proposals.map((p) => p.relation)] });
  const rounds: RelationWorkflowResult["rounds"] = [], contextDeferred: RelationContextExpansion["deferred"] = [];
  const usage = { requests: 0, inputTokens: 0, usd: 0 };
  let chars = 0, excerpts = 0;
  let added: RelationContextExpansion["added"] = [], stopReason: RelationWorkflowResult["stopReason"] = "answered";
  for (let round = 0; ; round++) {
    const report = await scan(input);
    rounds.push({ input: structuredClone(input), report, added });
    for (const key of ["requests", "inputTokens", "usd"] as const) usage[key] += report.usage[key];
    const needing = report.candidates.filter((c) => c.judgment?.choice === "insufficient_context" && c.claimJudgment?.choice === "supports").map((c) => c.relationId);
    if (!needing.length) { stopReason = report.errors.length ? "request-failed" : "answered"; break; }
    if (round >= maxRounds) { stopReason = "round-budget"; break; }
    const expanded = expandRelationContext(input, catalog, needing, { maxAddedChars: maxAddedChars - chars, maxExcerpts: maxExcerpts - excerpts });
    contextDeferred.push(...expanded.deferred);
    if (!expanded.added.length) { stopReason = expanded.deferred.length ? "context-budget" : "no-context"; break; }
    added = expanded.added; excerpts += added.length; chars += added.reduce((sum, item) => sum + item.evidence.quote.length, 0);
    input = expanded.input;
  }
  const report = rounds.at(-1)!.report;
  return { schema: "jev-lint-relation-workflow-1", input, report, discovery, rounds, contextDeferred, usage, stopReason, qualityVerdict: "UNREVIEWED",
    status: report.status === "failed" ? "failed" : report.status === "partial" || contextDeferred.length || discovery && (discovery.missingClaimIds.length || discovery.unmatchedClaimIds.length || discovery.deferredClaimIds.length || discovery.unindexed.length) ? "partial" : "complete" };
}
