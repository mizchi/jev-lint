import { isDeepStrictEqual } from "node:util";
import type { RelationQuestion as ChoiceQuestion } from "./relation-contract.ts";
import { planRelations, relationState, type RelationPlanOptions } from "./relation-plan.ts";
import { prepareQuestion, questionSet } from "./relation-questions.ts";
import { parseRelationInput, readRelationJudgment, relationDigest, type RelationInput, type RelationSubject, type RelationCandidate, type RelationReport, type RelationResolution, type RelationJudgment } from "./relation-contract.ts";

export function resolution(input: RelationInput, relation: RelationSubject, judgment: RelationJudgment | null, claimJudgment: RelationJudgment | null): RelationResolution {
  if (!judgment || !claimJudgment) return "needs_context";
  const sources = new Map(input.sources.map((source) => [source.id, source]));
  const specification = input.claims.find((claim) => claim.id === relation.claimId)!;
  if (!specification.evidence.some((e) => sources.get(e.sourceId)!.authority === "approved")) return judgment.choice === "unrelated" ? "none" : "needs_decision";
  if (claimJudgment.choice !== "supports") return "needs_context";
  if (judgment.choice === "unrelated") return "none";
  if (judgment.choice === "insufficient_context") return "needs_context";
  if (judgment.choice === "supports") return "none";
  const targets = relation.targets.map((e) => sources.get(e.sourceId)!);
  if (targets.some((source) => source.authority === "approved")) return "needs_decision";
  if (targets.every((source) => source.kind === "documentation")) return "documentation";
  if (targets.every((source) => source.kind !== "documentation")) return "implementation";
  return "needs_decision";
}

export function assembleReport(input: RelationInput, plan: RelationReport["plan"], candidates: RelationCandidate[], model: string | null,
  usage: RelationReport["usage"], errors: RelationReport["errors"], promptRevision: string): RelationReport {
  const ledger = input.expectedClaimIds.map((claimId) => {
    const plannedRelationIds = input.relations.filter((relation) => relation.claimId === claimId).map((relation) => relation.id);
    return { claimId, plannedRelationIds,
      evaluatedRelationIds: candidates.filter((c) => c.claimId === claimId && c.judgment !== null && c.claimJudgment !== null).map((c) => c.relationId),
      missingRelationIds: candidates.filter((c) => c.claimId === claimId && (c.judgment === null || c.claimJudgment === null)).map((c) => c.relationId),
      excludedRelationIds: plan.excluded.filter((e) => plannedRelationIds.includes(e.relationId)).map((e) => e.relationId) };
  });
  const answered = candidates.filter((c) => c.judgment !== null && c.claimJudgment !== null).length;
  const coverage = { expectedClaims: input.expectedClaimIds.length, unplannedClaims: ledger.filter((row) => row.plannedRelationIds.length === 0).length,
    plannedRelations: input.relations.length, selectedRelations: plan.selected.length, answered, missing: candidates.length - answered,
    insufficientContext: candidates.filter((c) => c.judgment?.choice === "insufficient_context" || c.claimJudgment?.choice === "insufficient_context").length,
    ungroundedRelations: candidates.filter((c) => c.claimJudgment !== null && c.claimJudgment.choice !== "supports").length,
    deferred: plan.excluded.filter((item) => item.reason !== "outside-change").length,
    outsideChange: plan.excluded.filter((item) => item.reason === "outside-change").length };
  const status = plan.selected.length > 0 && answered === 0 ? "failed" : coverage.missing || coverage.unplannedClaims || coverage.insufficientContext || coverage.ungroundedRelations || coverage.deferred ? "partial" : "complete";
  return { schema: "jev-lint-relations-1", repository: input.repository, sourceSha: input.sourceSha, runId: input.runId, inputDigest: relationDigest(input), status,
    engine: { model, promptRevision }, plan, candidates, ledger, coverage, usage, errors };
}

/** Bind an artifact to the exact requested input, plan and current prompt. Origin still needs a trusted channel. */
export function parseRelationReport(raw: unknown, rawInput: RelationInput, options: RelationPlanOptions & { question?: ChoiceQuestion } = {}): RelationReport {
  const input = parseRelationInput(rawInput), plan = planRelations(input, options);
  const question = prepareQuestion(options.question), promptRevision = relationDigest(questionSet(question));
  const fail = (): never => { throw new Error("invalid relation report"); };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail();
  const report = raw as RelationReport;
  if (!report.engine || !(report.engine.model === null || typeof report.engine.model === "string") || report.engine.promptRevision !== promptRevision
    || !isDeepStrictEqual(report.plan, plan) || !Array.isArray(report.candidates) || report.candidates.length !== plan.selected.length
    || !Array.isArray(report.errors) || !report.usage || !Number.isSafeInteger(report.usage.requests) || report.usage.requests < 0
    || !Number.isSafeInteger(report.usage.inputTokens) || report.usage.inputTokens < 0 || !Number.isFinite(report.usage.usd) || report.usage.usd < 0) return fail();
  for (const [index, candidate] of report.candidates.entries()) {
    if (!candidate || candidate.relationId !== plan.selected[index]) return fail();
    const relation = input.relations.find((r) => r.id === candidate.relationId)!;
    const claim = input.claims.find((c) => c.id === relation.claimId)!;
    const state = relationState(input, relation);
    const judgment = candidate.judgment === null ? null : readRelationJudgment({ ...candidate.judgment, type: "choice" });
    if (candidate.judgment !== null && (!judgment || !isDeepStrictEqual(judgment, candidate.judgment))) return fail();
    const claimJudgment = candidate.claimJudgment === null ? null : readRelationJudgment({ ...candidate.claimJudgment, type: "choice" });
    if (candidate.claimJudgment !== null && (!claimJudgment || !isDeepStrictEqual(claimJudgment, candidate.claimJudgment))) return fail();
    const evidence = [
      ...claim.evidence.map((e) => ({ ...e, role: "specification" as const })),
      ...relation.targets.map((e) => ({ ...e, role: "target" as const })),
      ...relation.context.map((e) => ({ ...e, role: "context" as const })),
    ].map((e) => { const source = input.sources.find((s) => s.id === e.sourceId)!; return { ...e, path: source.path, ref: source.ref, contentHash: source.contentHash }; });
    const expected: RelationCandidate = { id: relationDigest({ repository: input.repository, claim, relation, state }), relationId: relation.id, claimId: claim.id,
      statement: claim.statement, judgment, claimJudgment, resolution: resolution(input, relation, judgment, claimJudgment), evidence,
      contextHash: relationDigest({ state, questions: questionSet(question) }) };
    if (!isDeepStrictEqual(candidate, expected)) return fail();
  }
  const missing = report.candidates.filter((candidate) => candidate.judgment === null || candidate.claimJudgment === null);
  if (report.errors.length !== missing.length || new Set(report.errors.map((e) => e.relationId)).size !== missing.length
    || report.errors.some((error) => !error || !missing.some((c) => c.relationId === error.relationId) || !["request-failed", "unusable-answer"].includes(error.code))) return fail();
  const rebuilt = assembleReport(input, plan, report.candidates, report.engine.model, report.usage, report.errors, promptRevision);
  if (!isDeepStrictEqual(report, rebuilt)) return fail();
  return structuredClone(rebuilt);
}
