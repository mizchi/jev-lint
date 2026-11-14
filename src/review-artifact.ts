import { digest, parseScanResult } from "./scan-contract.ts";
import { parseRelationReport } from "./relation-report.ts";
import { relationPath, type RelationInput, type RelationReport } from "./relation-contract.ts";
import type { RelationPlanOptions } from "./relation-plan.ts";

export interface ReviewScope { scopeId: string; modelRevision?: string }
export interface ReviewEvidence { path: string; ref: string; startLine: number; endLine: number; quote: string; role: "specification" | "target" | "context" }
export interface ReviewObservation {
  id: string; key: string; fingerprint: string | null; ruleId: string; message: string;
  state: "finding" | "clean" | "unassessed"; evidence: ReviewEvidence[];
}
export interface ReviewArtifact {
  schema: "jev-lint-review-artifact-1"; repository: string; sourceSha: string; runId: string; artifactDigest: string;
  scopeId: string; modelRevision: string | null; status: "complete" | "partial" | "failed";
  qualityVerdict: "UNREVIEWED"; observations: ReviewObservation[];
}

function assemble(identity: { repository: string; sourceSha: string; runId: string; status: ReviewArtifact["status"] }, original: unknown, scope: ReviewScope, observations: ReviewObservation[]): ReviewArtifact {
  return parseReviewArtifact({ schema: "jev-lint-review-artifact-1", repository: identity.repository, sourceSha: identity.sourceSha, runId: identity.runId,
    artifactDigest: digest(original), scopeId: scope.scopeId, modelRevision: scope.modelRevision ?? null, qualityVerdict: "UNREVIEWED", observations,
    status: identity.status === "failed" ? "failed" : identity.status === "partial" || observations.some((o) => o.state === "unassessed") ? "partial" : "complete" });
}

/** Continuity keys exclude line positions. Acceptance fingerprints still bind the entire judged context. */
export function reviewScan(raw: unknown, scope: ReviewScope): ReviewArtifact {
  const scan = parseScanResult(raw);
  return assemble(scan, scan, scope, scan.candidates.map((c) => ({ id: c.id, key: digest({ repository: scan.repository, rule: c.rule.id, path: c.source.path, evidence: c.evidence }),
    fingerprint: c.contextHash === null ? null : digest({ context: c.contextHash, rule: c.rule, policy: scan.policy, engine: scan.engine, modelRevision: scope.modelRevision ?? null,
      judgment: c.judgment && { kind: c.judgment.kind, maximum: c.judgment.maximum, threshold: c.judgment.threshold } }),
    ruleId: c.rule.id, message: c.claim, state: c.disposition === "missing" || c.contextHash === null ? "unassessed" : c.disposition === "reported" ? "finding" : "clean",
    evidence: [{ path: c.source.path, ref: scan.sourceSha, startLine: c.source.startLine, endLine: c.source.endLine, quote: c.evidence, role: "target" }],
  })));
}

export function reviewRelations(raw: unknown, input: RelationInput, scope: ReviewScope, options: RelationPlanOptions = {}): ReviewArtifact {
  const report = parseRelationReport(raw, input, options);
  return assemble(report, report, scope, report.candidates.map((c) => ({ id: c.id,
    key: digest({ repository: report.repository, claimId: c.claimId, relationId: c.relationId, targets: c.evidence.filter((e) => e.role === "target").map((e) => e.path).sort() }),
    fingerprint: c.judgment && c.claimJudgment ? digest({ context: c.contextHash, engine: report.engine, modelRevision: scope.modelRevision ?? null }) : null,
    ruleId: `relations/${c.claimId}`, message: `${c.statement} (${c.resolution})`,
    state: !c.judgment || c.claimJudgment?.choice !== "supports" || c.resolution === "needs_context" || c.resolution === "needs_decision" ? "unassessed" : c.resolution === "none" ? "clean" : "finding",
    evidence: c.evidence.map(({ path, ref, startLine, endLine, quote, role }) => ({ path, ref, startLine, endLine, quote, role })),
  })));
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown, max = 4000): v is string => typeof v === "string" && !!v.trim() && v.length <= max;
export function parseReviewArtifact(raw: unknown): ReviewArtifact {
  const fail = (): never => { throw new Error("invalid review artifact"); };
  if (!object(raw) || raw.schema !== "jev-lint-review-artifact-1" || !text(raw.repository) || !/^[\w.-]+\/[\w.-]+$/.test(raw.repository)
    || raw.repository.split("/").some((part) => part === "." || part === "..") || typeof raw.sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(raw.sourceSha)
    || !text(raw.runId, 128) || !hash(raw.artifactDigest) || !text(raw.scopeId, 128) || !(raw.modelRevision === null || text(raw.modelRevision, 256))
    || raw.qualityVerdict !== "UNREVIEWED" || !["complete", "partial", "failed"].includes(String(raw.status)) || !Array.isArray(raw.observations) || raw.observations.length > 100000) return fail();
  const ids = new Set<string>();
  for (const o of raw.observations) {
    if (!object(o) || !hash(o.id) || ids.has(o.id) || !hash(o.key) || !(hash(o.fingerprint) || o.fingerprint === null)
      || !text(o.ruleId, 256) || !text(o.message, 16000) || !["finding", "clean", "unassessed"].includes(String(o.state))
      || o.state !== "unassessed" && o.fingerprint === null || !Array.isArray(o.evidence) || !o.evidence.length || o.evidence.length > 60) return fail();
    ids.add(o.id);
    for (const e of o.evidence) if (!object(e) || !relationPath(e.path) || typeof e.ref !== "string" || !/^[a-f0-9]{40}$/.test(e.ref)
      || !Number.isSafeInteger(e.startLine) || !Number.isSafeInteger(e.endLine) || Number(e.startLine) < 1 || Number(e.endLine) < Number(e.startLine)
      || typeof e.quote !== "string" || !["target", "specification", "context"].includes(String(e.role))) return fail();
  }
  if (raw.status === "complete" && raw.observations.some((o) => o.state === "unassessed")) return fail();
  return structuredClone(raw) as unknown as ReviewArtifact;
}
