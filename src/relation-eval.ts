import { isDeepStrictEqual } from "node:util";
import { parseRelationInput, readRelationJudgment, RELATION_CHOICES, relationDigest, type RelationInput, type RelationChoice, type RelationResolution, type RelationReport } from "./relation-contract.ts";
import { relationState, planRelations } from "./relation-plan.ts";
import { RELATION_QUESTION, CLAIM_GROUNDING_QUESTION } from "./relations.ts";
import type { ChoiceQuestion } from "./types.ts";

export interface RelationCase { id: string; input: RelationInput }
export interface RelationExpectation { id: string; choices: RelationChoice[]; resolution: RelationResolution; statuses: RelationReport["status"][] }
export interface RelationEvalSample { id: string; pass: number; report: RelationReport | null; checks: { semantic: boolean; direction: boolean; evidence: boolean; coverage: boolean } }
export interface RelationEvaluation {
  schema: "jev-lint-relation-eval-1"; protocol: "single-choice" | "grounded-choice"; corpusDigest: string; repeat: number; samples: RelationEvalSample[];
  dimensions: Array<{ id: keyof RelationEvalSample["checks"]; passed: number; expected: number; score: number }>;
  total: number; gate: "pass" | "fail"; missing: number; precision: number | null; recall: number | null;
}

function evidenceMatches(input: RelationInput, report: RelationReport, questions: Record<string, ChoiceQuestion>, requireGrounding: boolean): boolean {
  const promptRevision = relationDigest(requireGrounding ? questions : questions.q0000);
  if (report.schema !== "jev-lint-relations-1" || report.engine?.promptRevision !== promptRevision
    || report.inputDigest !== relationDigest(input) || report.repository !== input.repository || report.sourceSha !== input.sourceSha || report.runId !== input.runId
    || report.candidates.length !== input.relations.length) return false;
  return report.candidates.every((candidate) => {
    const relation = input.relations.find((r) => r.id === candidate.relationId);
    const claim = input.claims.find((c) => c.id === relation?.claimId);
    if (!relation || !claim || candidate.claimId !== claim.id || candidate.statement !== claim.statement) return false;
    const state = relationState(input, relation);
    if (candidate.id !== relationDigest({ repository: input.repository, claim, relation, state })
      || candidate.contextHash !== relationDigest({ state, questions })) return false;
    const expected = [
      ...claim.evidence.map((e) => ({ ...e, role: "specification" })),
      ...relation.targets.map((e) => ({ ...e, role: "target" })),
      ...relation.context.map((e) => ({ ...e, role: "context" })),
    ].map((e) => { const source = input.sources.find((s) => s.id === e.sourceId)!; return { ...e, path: source.path, ref: source.ref, contentHash: source.contentHash }; });
    return isDeepStrictEqual(expected, candidate.evidence);
  });
}

function coverageMatches(input: RelationInput, report: RelationReport, requireGrounding: boolean): boolean {
  if (!report.coverage || !report.usage || !Array.isArray(report.ledger) || !Array.isArray(report.errors) || report.errors.length !== 0
    || report.candidates.length !== input.relations.length || !isDeepStrictEqual(report.plan, planRelations(input))
    || !Number.isSafeInteger(report.usage.requests) || report.usage.requests < 0 || !Number.isSafeInteger(report.usage.inputTokens) || report.usage.inputTokens < 0
    || !Number.isFinite(report.usage.usd) || report.usage.usd < 0) return false;
  const answered = (candidate: RelationReport["candidates"][number]) => !!readRelationJudgment({ ...candidate.judgment, type: "choice" })
    && (!requireGrounding || !!readRelationJudgment({ ...candidate.claimJudgment, type: "choice" }));
  const ledger = input.expectedClaimIds.map((claimId) => ({ claimId,
    plannedRelationIds: input.relations.filter((r) => r.claimId === claimId).map((r) => r.id),
    evaluatedRelationIds: report.candidates.filter((c) => c.claimId === claimId && answered(c)).map((c) => c.relationId),
    missingRelationIds: report.candidates.filter((c) => c.claimId === claimId && !answered(c)).map((c) => c.relationId), excludedRelationIds: [],
  }));
  const expected = { expectedClaims: input.expectedClaimIds.length, unplannedClaims: ledger.filter((row) => !row.plannedRelationIds.length).length,
    plannedRelations: input.relations.length, selectedRelations: input.relations.length, answered: report.candidates.filter(answered).length,
    missing: report.candidates.filter((c) => !answered(c)).length,
    insufficientContext: report.candidates.filter((c) => c.judgment?.choice === "insufficient_context" || requireGrounding && c.claimJudgment?.choice === "insufficient_context").length,
    ...(requireGrounding ? { ungroundedRelations: report.candidates.filter((c) => c.claimJudgment && c.claimJudgment.choice !== "supports").length } : {}),
    deferred: 0, outsideChange: 0 };
  const status = expected.answered === 0 ? "failed" : expected.missing || expected.unplannedClaims || expected.insufficientContext
    || ("ungroundedRelations" in expected && expected.ungroundedRelations) ? "partial" : "complete";
  return isDeepStrictEqual(report.ledger, ledger) && isDeepStrictEqual(report.coverage, expected) && report.status === status;
}

export async function evaluateRelations({ cases, expected, repeat, run, requireGrounding = true, questions }: {
  cases: RelationCase[]; expected: RelationExpectation[]; repeat: number;
  run(input: RelationInput): Promise<RelationReport>;
  requireGrounding?: boolean;
  questions?: Record<string, ChoiceQuestion>;
}): Promise<RelationEvaluation> {
  if (!Number.isSafeInteger(repeat) || repeat < 1 || !cases.length || new Set(cases.map((c) => c.id)).size !== cases.length
    || new Set(expected.map((e) => e.id)).size !== expected.length || expected.length !== cases.length
    || cases.some((c) => !expected.some((e) => e.id === c.id))) throw new Error("invalid relation evaluation corpus");
  for (const item of cases) if (parseRelationInput(item.input).relations.length !== 1) throw new Error("each evaluation case must declare one relation");
  for (const item of expected) if (!Array.isArray(item.choices) || !item.choices.length || !item.choices.every((choice) => RELATION_CHOICES.includes(choice))
    || !["none", "implementation", "documentation", "needs_context", "needs_decision"].includes(item.resolution)
    || !Array.isArray(item.statuses) || !item.statuses.length || !item.statuses.every((status) => ["complete", "partial", "failed"].includes(status))) throw new Error("invalid relation oracle");
  const manifest = structuredClone(questions ?? { q0000: RELATION_QUESTION, ...(requireGrounding ? { q0001: CLAIM_GROUNDING_QUESTION } : {}) });
  const samples: RelationEvalSample[] = [];
  let missing = 0, positives = 0, defects = 0, detected = 0;
  for (let pass = 1; pass <= repeat; pass++) for (const item of cases) {
    const oracle = expected.find((e) => e.id === item.id)!;
    let report: RelationReport | null = null, usable = false;
    const input = structuredClone(item.input);
    input.runId = `sample-${samples.length + 1}`;
    const checks = { semantic: false, direction: false, evidence: false, coverage: false };
    try {
      report = await run(input);
      const candidate = report.candidates[0], judgment = readRelationJudgment({ ...candidate?.judgment, type: "choice" });
      const grounding = readRelationJudgment({ ...candidate?.claimJudgment, type: "choice" });
      usable = !!judgment && (grounding !== null || !requireGrounding && !("claimJudgment" in candidate));
      checks.semantic = usable && oracle.choices.includes(judgment!.choice);
      checks.direction = usable && candidate.resolution === oracle.resolution;
      checks.evidence = evidenceMatches(input, report, manifest, requireGrounding);
      checks.coverage = usable && oracle.statuses.includes(report.status) && coverageMatches(input, report, requireGrounding);
      const predicted = usable && judgment?.choice === "contradicts" && ["implementation", "documentation"].includes(candidate.resolution);
      const positive = ["implementation", "documentation"].includes(oracle.resolution);
      if (predicted) positives++;
      if (predicted && positive) detected++;
    } catch { report = null; usable = false; for (const key of ["semantic", "direction", "evidence", "coverage"] as const) checks[key] = false; }
    if (["implementation", "documentation"].includes(oracle.resolution)) defects++;
    if (!usable) missing++;
    samples.push({ id: item.id, pass, report, checks });
  }
  const dimensions = (["semantic", "direction", "evidence", "coverage"] as const).map((id) => {
    const passed = samples.filter((sample) => sample.checks[id]).length;
    return { id, passed, expected: samples.length, score: 4 * passed / samples.length };
  });
  return { schema: "jev-lint-relation-eval-1", protocol: requireGrounding ? "grounded-choice" : "single-choice", corpusDigest: relationDigest({ cases, expected }), repeat, samples, dimensions,
    total: 25 * dimensions.reduce((sum, dimension) => sum + dimension.score, 0) / dimensions.length,
    gate: dimensions.every((dimension) => dimension.passed === dimension.expected) ? "pass" : "fail", missing,
    precision: positives ? detected / positives : null, recall: defects ? detected / defects : null };
}

export function compareRelationEvaluations(before: RelationEvaluation, after: RelationEvaluation) {
  if (before.corpusDigest !== after.corpusDigest || before.repeat !== after.repeat) throw new Error("relation evaluations are not comparable");
  const regressions: string[] = [];
  for (const old of before.samples) {
    const current = after.samples.find((s) => s.id === old.id && s.pass === old.pass);
    for (const key of ["semantic", "direction", "evidence", "coverage"] as const) if (old.checks[key] && !current?.checks[key]) regressions.push(`${old.id}:${old.pass}:${key}`);
  }
  return { delta: after.total - before.total, regressions, accepted: after.gate === "pass" && regressions.length === 0 };
}

export async function replayRelationEvaluation(cases: RelationCase[], expected: RelationExpectation[], raw: RelationEvaluation): Promise<RelationEvaluation> {
  if (!raw || raw.schema !== "jev-lint-relation-eval-1" || raw.corpusDigest !== relationDigest({ cases, expected })
    || !Number.isSafeInteger(raw.repeat) || raw.repeat < 1 || !Array.isArray(raw.samples)) throw new Error("relation evaluations are not comparable");
  const records = new Map<string, RelationEvalSample>();
  for (const sample of raw.samples) {
    const key = JSON.stringify([sample.id, sample.pass]);
    if (!cases.some((item) => item.id === sample.id) || !Number.isSafeInteger(sample.pass) || sample.pass < 1 || sample.pass > raw.repeat || records.has(key)) throw new Error("invalid relation evaluation sample");
    records.set(key, sample);
  }
  const hasGrounding = (raw as RelationEvaluation & { groundingQuestion?: unknown }).groundingQuestion != null
    || raw.samples.some((sample) => sample.report?.candidates?.some((candidate) => candidate && Object.hasOwn(candidate, "claimJudgment")));
  if (raw.protocol !== undefined && !["single-choice", "grounded-choice"].includes(raw.protocol)
    || raw.protocol === "single-choice" && hasGrounding) throw new Error("invalid relation evaluation protocol");
  const requireGrounding = raw.protocol === "grounded-choice" || hasGrounding;
  const metadata = raw as RelationEvaluation & { question?: ChoiceQuestion; groundingQuestion?: ChoiceQuestion };
  const questions = { q0000: metadata.question ?? RELATION_QUESTION, ...(requireGrounding ? { q0001: metadata.groundingQuestion ?? CLAIM_GROUNDING_QUESTION } : {}) };
  let index = 0;
  return evaluateRelations({ cases, expected, repeat: raw.repeat, requireGrounding, questions, run: async () => {
    const item = cases[index % cases.length], pass = Math.floor(index++ / cases.length) + 1;
    const report = records.get(JSON.stringify([item.id, pass]))?.report;
    if (!report) throw new Error("missing evaluation evidence");
    return report;
  } });
}
