import { Jev, type AskClient, type JevOptions } from "./jev.ts";
import type { ChoiceQuestion } from "./types.ts";
import { planRelations, relationState, type RelationPlanOptions } from "./relation-plan.ts";
import { parseRelationInput, readRelationJudgment, relationDigest, type RelationInput, type RelationCandidate, type RelationReport, type RelationJudgment } from "./relation-contract.ts";
import { prepareQuestion, questionSet } from "./relation-questions.ts";
import { assembleReport, resolution } from "./relation-report.ts";
export * from "./relation-contract.ts";
export { planRelations, planRelationDiff, readSpecSources } from "./relation-plan.ts";
export type { RelationPlanOptions, SpecSourceManifest } from "./relation-plan.ts";
export { RELATION_QUESTION, CLAIM_GROUNDING_QUESTION, RELATION_PROMPT_REVISION } from "./relation-questions.ts";
export { parseRelationReport } from "./relation-report.ts";
export { discoverRelations, indexRelationSources } from "./relation-discovery.ts";
export type { RelationCatalog, RelationDiscovery, RelationDiscoveryOptions } from "./relation-discovery.ts";
export { expandRelationContext } from "./relation-context.ts";
export { screenRelationWorkflow, parseRelationWorkflow } from "./relation-workflow.ts";
export type { RelationWorkflowOptions, RelationWorkflowResult } from "./relation-workflow.ts";

export interface RelationsOptions extends RelationPlanOptions {
  client?: AskClient;
  clientOptions?: JevOptions;
  question?: ChoiceQuestion;
}

export async function scanRelations(raw: RelationInput, options: RelationsOptions = {}): Promise<RelationReport> {
  const input = parseRelationInput(raw), plan = planRelations(input, options);
  const question = prepareQuestion(options.question);
  const client = options.client ?? new Jev(options.clientOptions);
  const before = { ...client.spent };
  const candidates: RelationCandidate[] = [], errors: RelationReport["errors"] = [];
  const sources = new Map(input.sources.map((source) => [source.id, source]));
  for (const relationId of plan.selected) {
    const relation = input.relations.find((item) => item.id === relationId)!;
    const claim = input.claims.find((item) => item.id === relation.claimId)!;
    const state = relationState(input, relation), questions = questionSet(question), contextHash = relationDigest({ state, questions });
    let judgment: RelationJudgment | null = null, claimJudgment: RelationJudgment | null = null;
    try {
      const response = await client.askSplitting(state, questions);
      judgment = readRelationJudgment(response.answers?.q0000);
      claimJudgment = readRelationJudgment(response.answers?.q0001);
      if (!judgment || !claimJudgment) errors.push({ relationId, code: "unusable-answer" });
    } catch { errors.push({ relationId, code: "request-failed" }); }
    const evidence = [
      ...claim.evidence.map((e) => ({ ...e, role: "specification" as const })),
      ...relation.targets.map((e) => ({ ...e, role: "target" as const })),
      ...relation.context.map((e) => ({ ...e, role: "context" as const })),
    ].map((e) => ({ ...e, path: sources.get(e.sourceId)!.path, ref: sources.get(e.sourceId)!.ref, contentHash: sources.get(e.sourceId)!.contentHash }));
    candidates.push({ id: relationDigest({ repository: input.repository, claim, relation, state }), relationId, claimId: claim.id, statement: claim.statement,
      judgment, claimJudgment, resolution: resolution(input, relation, judgment, claimJudgment), evidence, contextHash });
  }
  return assembleReport(input, plan, candidates, client.servedModel,
    { requests: Math.max(0, client.spent.calls - before.calls), inputTokens: Math.max(0, client.spent.inputTokens - before.inputTokens), usd: Math.max(0, client.spent.usd - before.usd) }, errors, relationDigest(questionSet(question)));
}
