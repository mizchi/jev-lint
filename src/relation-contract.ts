import { createHash } from "node:crypto";

export const RELATION_CHOICES = ["supports", "contradicts", "unrelated", "insufficient_context"] as const;
export type RelationChoice = typeof RELATION_CHOICES[number];
export type RelationResolution = "none" | "implementation" | "documentation" | "needs_context" | "needs_decision";
export interface RelationQuestion { type: "choice"; instructions: Record<string, unknown>; criteria: Record<string, string> }
export interface SpecSource {
  id: string; path: string; ref: string; kind: "documentation" | "code" | "test" | "config";
  authority: "approved" | "reference" | "proposal" | "observed";
  content: string; contentHash: string; scope: string[];
  approval: { id: string; revision: number; digest: string } | null;
}
export interface RelationEvidence { sourceId: string; startLine: number; endLine: number; quote: string }
export interface SpecClaim { id: string; statement: string; evidence: RelationEvidence[] }
export interface RelationSubject { id: string; subject: "relation"; claimId: string; targets: RelationEvidence[]; context: RelationEvidence[] }
export interface RelationInput {
  schema: "jev-lint-relations-input-1"; repository: string; sourceSha: string; runId: string;
  sources: SpecSource[]; claims: SpecClaim[]; expectedClaimIds: string[]; relations: RelationSubject[];
}
export interface RelationJudgment { choice: RelationChoice; confidence: number; probabilities: Record<RelationChoice, number> }
export interface RelationPlan {
  baseSha?: string;
  changedPaths: string[] | null;
  selected: string[];
  excluded: Array<{ relationId: string; reason: "outside-change" | "outside-scope" | "relation-budget" | "context-budget" }>;
}
export interface RelationCandidate {
  id: string; relationId: string; claimId: string; statement: string;
  judgment: RelationJudgment | null; claimJudgment: RelationJudgment | null; resolution: RelationResolution;
  evidence: Array<RelationEvidence & { role: "specification" | "target" | "context"; path: string; ref: string; contentHash: string }>;
  contextHash: string;
}
export interface RelationReport {
  schema: "jev-lint-relations-1"; repository: string; sourceSha: string; runId: string; inputDigest: string;
  status: "complete" | "partial" | "failed";
  engine: { model: string | null; promptRevision: string };
  plan: RelationPlan; candidates: RelationCandidate[];
  ledger: Array<{ claimId: string; plannedRelationIds: string[]; evaluatedRelationIds: string[]; missingRelationIds: string[]; excludedRelationIds: string[] }>;
  coverage: { expectedClaims: number; unplannedClaims: number; plannedRelations: number; selectedRelations: number; answered: number; missing: number; insufficientContext: number; ungroundedRelations: number; deferred: number; outsideChange: number };
  usage: { requests: number; inputTokens: number; usd: number };
  errors: Array<{ relationId: string; code: "request-failed" | "unusable-answer" }>;
}

export const relationDigest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[\w.-]{1,128}$/.test(value);
const text = (value: unknown, max = 4000): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
export const relationPath = (value: unknown): value is string => typeof value === "string" && value.length > 0
  && !/^[a-z]:|[\\\x00-\x1f\x7f]/i.test(value) && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
const fail = (): never => { throw new Error("invalid relation input"); };
function fields(value: Record<string, unknown>, allowed: string[]): void { if (Object.keys(value).some((key) => !allowed.includes(key))) fail(); }

/** The caller supplies authority; a document's prose cannot approve itself. */
export function parseRelationInput(raw: unknown): RelationInput {
  if (!record(raw)) return fail();
  fields(raw, ["schema", "repository", "sourceSha", "runId", "sources", "claims", "expectedClaimIds", "relations"]);
  if (raw.schema !== "jev-lint-relations-input-1" || typeof raw.repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(raw.repository)
    || raw.repository.split("/").some((part) => part === "." || part === "..") || !sha(raw.sourceSha) || !id(raw.runId)
    || !Array.isArray(raw.sources) || !raw.sources.length || raw.sources.length > 100 || !Array.isArray(raw.claims) || raw.claims.length > 200
    || !Array.isArray(raw.relations) || raw.relations.length > 1000 || !Array.isArray(raw.expectedClaimIds) || raw.expectedClaimIds.length > 1000) return fail();
  const sources = new Map<string, SpecSource>();
  let size = 0;
  for (const source of raw.sources) {
    if (!record(source)) return fail();
    fields(source, ["id", "path", "ref", "kind", "authority", "content", "contentHash", "scope", "approval"]);
    if (!id(source.id) || sources.has(source.id) || !relationPath(source.path) || !sha(source.ref)
      || !["documentation", "code", "test", "config"].includes(String(source.kind)) || !["approved", "reference", "proposal", "observed"].includes(String(source.authority))
      || typeof source.content !== "string" || source.content.length > 128000 || !hash(source.contentHash) || relationDigest(source.content) !== source.contentHash
      || !Array.isArray(source.scope) || source.scope.length > 100 || !source.scope.every((path) => path === "." || relationPath(path))) return fail();
    if (source.authority === "approved") {
      if (source.kind !== "documentation" || !source.scope.length || !record(source.approval)) return fail();
      fields(source.approval, ["id", "revision", "digest"]);
      if (!id(source.approval.id) || !Number.isSafeInteger(source.approval.revision) || Number(source.approval.revision) < 1 || !hash(source.approval.digest)) return fail();
    } else if (source.approval !== null || source.ref !== raw.sourceSha) return fail();
    if ((source.authority === "observed") === (source.kind === "documentation")) return fail();
    sources.set(source.id, source as unknown as SpecSource); size += source.content.length;
  }
  if (size > 512000) return fail();
  const evidence = (value: unknown): value is RelationEvidence => {
    if (!record(value)) return false;
    fields(value, ["sourceId", "startLine", "endLine", "quote"]);
    const source = sources.get(String(value.sourceId));
    if (!source || !Number.isSafeInteger(value.startLine) || !Number.isSafeInteger(value.endLine) || Number(value.startLine) < 1
      || Number(value.endLine) < Number(value.startLine) || !text(value.quote, 64000)) return false;
    const lines = source.content.split("\n");
    return Number(value.endLine) <= lines.length && lines.slice(Number(value.startLine) - 1, Number(value.endLine)).join("\n") === value.quote;
  };
  const claims = new Set<string>();
  for (const claim of raw.claims) {
    if (!record(claim)) return fail();
    fields(claim, ["id", "statement", "evidence"]);
    if (!id(claim.id) || claims.has(claim.id) || !text(claim.statement) || !Array.isArray(claim.evidence)
      || !claim.evidence.length || claim.evidence.length > 20 || !claim.evidence.every(evidence)) return fail();
    claims.add(claim.id);
  }
  if (!raw.expectedClaimIds.every(id) || new Set(raw.expectedClaimIds).size !== raw.expectedClaimIds.length) return fail();
  const relations = new Set<string>();
  for (const relation of raw.relations) {
    if (!record(relation)) return fail();
    fields(relation, ["id", "subject", "claimId", "targets", "context"]);
    if (!id(relation.id) || relations.has(relation.id) || relation.subject !== "relation" || !claims.has(String(relation.claimId))
      || !Array.isArray(relation.targets) || !relation.targets.length || relation.targets.length > 20 || !relation.targets.every(evidence)
      || !Array.isArray(relation.context) || relation.context.length > 20 || !relation.context.every(evidence)) return fail();
    relations.add(relation.id);
  }
  return structuredClone(raw) as unknown as RelationInput;
}

export function readRelationJudgment(raw: unknown): RelationJudgment | null {
  if (!record(raw) || raw.type !== "choice" || !RELATION_CHOICES.includes(raw.choice as RelationChoice)
    || typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1 || !record(raw.probabilities)
    || Object.keys(raw.probabilities).length !== RELATION_CHOICES.length) return null;
  const probabilities = raw.probabilities;
  if (!RELATION_CHOICES.every((choice) => typeof probabilities[choice] === "number" && Number.isFinite(probabilities[choice]) && probabilities[choice] >= 0 && probabilities[choice] <= 1)) return null;
  const values = RELATION_CHOICES.map((choice) => probabilities[choice] as number);
  if (Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.00001 || Number(probabilities[String(raw.choice)]) < Math.max(...values) - 0.00001) return null;
  return { choice: raw.choice as RelationChoice, confidence: raw.confidence, probabilities: structuredClone(probabilities) as Record<RelationChoice, number> };
}
