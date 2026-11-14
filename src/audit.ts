import { ruleTextHash } from "./rules.ts";
import { TRUNCATION_MARKER } from "./state.ts";
import type { RunResult } from "./types.ts";
import { SCAN_SCHEMA, QUESTION_SCHEMA, digest, scanStatus, parseScanResult } from "./scan-contract.ts";
import type { ScanIdentity, ScanResultV1, ScanCandidateV1, ScanCoverageV1 } from "./scan-contract.ts";
export * from "./scan-contract.ts";

/** Scope completion describes the selected subjects, never a proof about the repository. */
export function buildScanResult(result: RunResult, identity: ScanIdentity, { maxCandidates }: { maxCandidates?: number } = {}): ScanResultV1 {
  if (!/^[a-f0-9]{40}$/.test(identity.sourceSha)) throw new Error("sourceSha must be an immutable commit SHA");
  if (!identity.runId || !/^[\w.-]+\/[\w.-]+$/.test(identity.repository)) throw new Error("invalid scan identity");
  if (maxCandidates !== undefined && (!Number.isSafeInteger(maxCandidates) || maxCandidates < 0)) throw new Error("invalid candidate limit");
  const contexts = new Map<string, string>();
  const sharedContexts = new Map<string, string>();
  const key = (file: string, line: number, rule: string, byte?: number) => JSON.stringify([file, line, rule, byte ?? null]);
  const ruleId = (s: RunResult["subjects"][number]) => s.rule.languageDir ? `${s.rule.languageDir}/${s.rule.id}` : s.rule.id;
  const subjects = new Map(result.subjects.map((s) => [key(s.file, s.line, ruleId(s), s.matchStartByte), s]));
  for (const batch of result.batches) for (const subject of batch.subjects) {
    contexts.set(key(subject.file, subject.line, ruleId(subject), subject.matchStartByte), digest({ state: batch.state, questions: batch.questions }));
    if (subject.key) sharedContexts.set(subject.key, digest({ state: batch.state, questions: batch.questions }));
  }
  const candidates = result.all.map((finding): ScanCandidateV1 => {
    const subject = subjects.get(key(finding.file, finding.line, finding.ruleKey ?? finding.rule, finding.matchStartByte));
    if (!subject) throw new Error("scan finding has no source subject");
    const rule = { id: finding.ruleKey ?? finding.rule, digest: ruleTextHash(subject.rule) };
    const source = { path: subject.file, startLine: subject.subjectLine ?? subject.line, endLine: subject.subjectEndLine ?? subject.endLine, contentHash: digest(subject.text),
      ...(subject.matchStartByte === undefined ? {} : { matchStartByte: subject.matchStartByte, matchEndByte: subject.matchEndByte }) };
    return {
      id: digest({ repository: identity.repository, rule, source, captures: subject.captured }), rule, source,
      claim: subject.rule.ask, evidence: subject.text,
      disposition: finding.messageId === "missing" ? "missing" : finding.reported ? "reported" : finding.value !== null && finding.value >= finding.at ? "retracted" : "below-threshold",
      judgment: finding.value === null ? null : { kind: subject.rule.kind, value: finding.value, confidence: finding.confidence,
        maximum: subject.rule.kind === "noul" ? 1 : (subject.rule.levels?.length ?? 4) - 1, threshold: finding.at },
      contextHash: contexts.get(key(subject.file, subject.line, rule.id, subject.matchStartByte)) ?? (subject.key ? sharedContexts.get(subject.key) : null) ?? null,
    };
  });
  const cap = maxCandidates ?? candidates.length;
  const missing = result.stats.missing + Math.max(0, result.subjects.length - result.all.length);
  const coverage: ScanCoverageV1 = {
    matched: result.subjects.length, answered: result.subjects.length - missing, missing,
    omittedCandidates: Math.max(0, candidates.length - cap), outsideDiff: result.skippedByDiff ?? 0,
    excludedFiles: result.excluded ?? 0, suppressed: result.ignored?.subjects ?? 0, unpaired: result.unpaired?.subjects ?? 0,
    undeclaredLanguages: result.undeclared ?? [], degradedBatches: result.batches.filter((b) => b.degraded).length,
    cutSubjects: result.subjects.filter((s) => s.textCut || s.text.endsWith(TRUNCATION_MARKER) || s.commit?.truncated || s.instructions?.truncated).length,
    noInstructionDoc: result.commits?.noInstructionDoc ?? 0, dryRun: result.dryRun ?? false,
  };
  const errors: ScanResultV1["errors"] = (result.errors ?? []).map((error) => ({
    stage: /^(explain|attribute):/.test(error.error) ? "follow-up" : "verdict",
    code: /unusable|missing/.test(error.error) ? "unusable-answer" : "request-failed", subjects: error.subjects,
  }));
  return parseScanResult({ schema: SCAN_SCHEMA, ...identity, status: scanStatus(coverage, errors), policy: result.policy ?? null,
    usage: { requests: result.spent.calls, inputTokens: result.spent.inputTokens, usd: result.spent.usd },
    engine: { questionSchema: QUESTION_SCHEMA, servedModel: result.servedModel ?? null }, coverage, candidates: candidates.slice(0, cap), errors });
}
