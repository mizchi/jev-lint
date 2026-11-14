import { createHash } from "node:crypto";

export const SCAN_SCHEMA = "jev-lint-scan-1" as const;
export const QUESTION_SCHEMA = "jev-lint-questions-1";
export const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface ScanIdentity { runId: string; repository: string; sourceSha: string }
export interface ScanCandidateV1 {
  id: string;
  rule: { id: string; digest: string };
  source: { path: string; startLine: number; endLine: number; contentHash: string; matchStartByte?: number; matchEndByte?: number };
  claim: string;
  evidence: string;
  disposition: "reported" | "below-threshold" | "retracted" | "missing";
  judgment: { kind: "score" | "noul"; value: number; confidence: number | null; maximum: number; threshold: number } | null;
  contextHash: string | null;
}
export interface ScanCoverageV1 {
  matched: number; answered: number; missing: number; omittedCandidates: number;
  outsideDiff: number; excludedFiles: number; suppressed: number; unpaired: number;
  undeclaredLanguages: string[]; degradedBatches: number; cutSubjects: number;
  noInstructionDoc: number; dryRun: boolean;
}
export interface ScanResultV1 extends ScanIdentity {
  schema: typeof SCAN_SCHEMA;
  status: "complete" | "partial" | "failed";
  policy: { ref: string; digest: string } | null;
  engine: { questionSchema: string; servedModel: string | null };
  usage: { requests: number; inputTokens: number; usd: number };
  coverage: ScanCoverageV1;
  candidates: ScanCandidateV1[];
  errors: Array<{ stage: "verdict" | "follow-up"; code: "request-failed" | "unusable-answer"; subjects: number }>;
}

export function scanStatus(coverage: ScanCoverageV1, errors: ScanResultV1["errors"]): ScanResultV1["status"] {
  if (!coverage.dryRun && coverage.matched > 0 && coverage.answered === 0) return "failed";
  return coverage.dryRun || coverage.missing > 0 || errors.length > 0 || coverage.omittedCandidates > 0
    || coverage.undeclaredLanguages.length > 0 || coverage.degradedBatches > 0 || coverage.cutSubjects > 0
    || coverage.unpaired > 0 || coverage.noInstructionDoc > 0 ? "partial" : "complete";
}

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const sourcePath = (v: unknown): v is string => typeof v === "string" && v.length > 0
  && !/^[a-z]:|[\\\x00-\x1f\x7f]/i.test(v) && v.split("/").every((part) => part !== "" && part !== "." && part !== "..");

/** Validate process-boundary data without treating a valid schema as trusted evidence. */
export function parseScanResult(raw: unknown): ScanResultV1 {
  const fail = (): never => { throw new Error("invalid scan result"); };
  if (!record(raw) || raw.schema !== SCAN_SCHEMA || typeof raw.runId !== "string" || !raw.runId
    || typeof raw.repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(raw.repository) || !sha(raw.sourceSha)
    || !record(raw.engine) || raw.engine.questionSchema !== QUESTION_SCHEMA
    || !(raw.engine.servedModel === null || typeof raw.engine.servedModel === "string")
    || !(raw.policy === null || record(raw.policy) && sha(raw.policy.ref) && hash(raw.policy.digest))
    || !record(raw.usage) || !count(raw.usage.requests) || !count(raw.usage.inputTokens) || !finite(raw.usage.usd) || raw.usage.usd < 0
    || !record(raw.coverage) || !Array.isArray(raw.candidates) || !Array.isArray(raw.errors)) return fail();
  const coverage = raw.coverage;
  for (const name of ["matched", "answered", "missing", "omittedCandidates", "outsideDiff", "excludedFiles", "suppressed", "unpaired", "degradedBatches", "cutSubjects", "noInstructionDoc"]) if (!count(coverage[name])) return fail();
  if (coverage.matched !== (coverage.answered as number) + (coverage.missing as number) || typeof coverage.dryRun !== "boolean"
    || !Array.isArray(coverage.undeclaredLanguages) || !coverage.undeclaredLanguages.every((v) => typeof v === "string")) return fail();
  const ids = new Set<string>();
  for (const candidate of raw.candidates) {
    if (!record(candidate) || !hash(candidate.id) || ids.has(candidate.id) || !record(candidate.rule) || typeof candidate.rule.id !== "string" || typeof candidate.rule.digest !== "string" || !/^[a-f0-9]{12}$/.test(candidate.rule.digest)
      || !record(candidate.source) || !sourcePath(candidate.source.path) || !count(candidate.source.startLine) || candidate.source.startLine < 1
      || !count(candidate.source.endLine) || candidate.source.endLine < candidate.source.startLine || !hash(candidate.source.contentHash)
      || typeof candidate.claim !== "string" || typeof candidate.evidence !== "string" || digest(candidate.evidence) !== candidate.source.contentHash
      || !(candidate.contextHash === null || hash(candidate.contextHash)) || !["reported", "below-threshold", "retracted", "missing"].includes(String(candidate.disposition))) return fail();
    ids.add(candidate.id);
    if ((candidate.source.matchStartByte !== undefined || candidate.source.matchEndByte !== undefined)
      && (!count(candidate.source.matchStartByte) || !count(candidate.source.matchEndByte) || candidate.source.matchEndByte < candidate.source.matchStartByte)) return fail();
    const judgment = candidate.judgment;
    if (candidate.disposition === "missing") { if (judgment !== null) return fail(); }
    else if (!record(judgment) || !["score", "noul"].includes(String(judgment.kind)) || !count(judgment.maximum) || judgment.maximum < 1
      || !finite(judgment.value) || judgment.value < 0 || judgment.value > judgment.maximum
      || judgment.kind === "noul" && (judgment.maximum !== 1 || judgment.confidence !== null)
      || !(judgment.confidence === null || finite(judgment.confidence) && judgment.confidence >= 0 && judgment.confidence <= 1)
      || !finite(judgment.threshold) || judgment.threshold < 0 || judgment.threshold > judgment.maximum) return fail();
    if (record(judgment)) {
      const above = (judgment.value as number) >= (judgment.threshold as number);
      if (candidate.disposition === "below-threshold" ? above : !above) return fail();
    }
  }
  for (const error of raw.errors) if (!record(error) || !["verdict", "follow-up"].includes(String(error.stage))
    || !["request-failed", "unusable-answer"].includes(String(error.code)) || !count(error.subjects)) return fail();
  const scan = raw as unknown as ScanResultV1;
  if (scan.candidates.length + scan.coverage.omittedCandidates > scan.coverage.matched || scan.status !== scanStatus(scan.coverage, scan.errors)) return fail();
  const visibleMissing = scan.candidates.filter((candidate) => candidate.disposition === "missing").length;
  if (visibleMissing > scan.coverage.missing || scan.candidates.length - visibleMissing > scan.coverage.answered) return fail();
  if (!scan.coverage.dryRun && (scan.candidates.length + scan.coverage.omittedCandidates !== scan.coverage.matched
    || scan.coverage.omittedCandidates === 0 && visibleMissing !== scan.coverage.missing)) return fail();
  return scan;
}
