import { parseReviewArtifact, type ReviewArtifact, type ReviewEvidence } from "./review-artifact.ts";
import { relationPath } from "./relation-contract.ts";
import type { ReportInput } from "./types.ts";

const uri = (path: string): string => {
  if (!relationPath(path)) throw new Error("SARIF requires repository-relative source paths");
  return path.split("/").map(encodeURIComponent).join("/");
};
const physical = (e: Pick<ReviewEvidence, "path" | "startLine" | "endLine">) => ({ artifactLocation: { uri: uri(e.path) }, region: { startLine: e.startLine, endLine: e.endLine } });
interface SarifResult {
  ruleId: string; level: "warning" | "note" | "error"; message: { text: string };
  locations: Array<{ physicalLocation: ReturnType<typeof physical> }>;
  partialFingerprints?: Record<string, string>; properties?: Record<string, unknown>; relatedLocations?: Array<Record<string, unknown>>;
}
function log(results: SarifResult[], complete: boolean, properties: Record<string, unknown>) {
  return { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{
    tool: { driver: { name: "jev-lint", informationUri: "https://github.com/mizchi/jev-lint", rules: [...new Set(results.map((r) => r.ruleId))].map((id) => ({ id })) } },
    invocations: [{ executionSuccessful: complete, ...(complete ? {} : { toolExecutionNotifications: [{ level: "warning", message: { text: "Incomplete declared scope; no quality verdict." } }] }) }],
    properties: { qualityVerdict: "UNREVIEWED", ...properties }, results,
  }] };
}

export function artifactSarif(raw: ReviewArtifact) {
  const artifact = parseReviewArtifact(raw);
  const results: SarifResult[] = artifact.observations.filter((o) => o.state !== "clean").map((o) => {
    const primary = o.evidence.find((e) => e.role === "target" && e.ref === artifact.sourceSha) ?? o.evidence.find((e) => e.ref === artifact.sourceSha);
    return { ruleId: o.ruleId, level: o.state === "finding" ? "warning" : "note", message: { text: o.message },
      locations: primary ? [{ physicalLocation: physical(primary) }] : [], partialFingerprints: { "jevLintContinuity/v1": o.key },
      properties: { candidateId: o.id, state: o.state, fingerprint: o.fingerprint },
      relatedLocations: o.evidence.filter((e) => e !== primary).map((e, i) => ({ id: i + 1, message: { text: `${e.role}: ${e.path}@${e.ref}` },
        ...(e.ref === artifact.sourceSha ? { physicalLocation: physical(e) } : { logicalLocations: [{ name: e.path, fullyQualifiedName: `${artifact.repository}@${e.ref}:${e.path}:${e.startLine}`, kind: "module" }] }),
        properties: { role: e.role, ref: e.ref, startLine: e.startLine, endLine: e.endLine },
      })),
    };
  });
  return log(results, artifact.status === "complete", { repository: artifact.repository, sourceSha: artifact.sourceSha, runId: artifact.runId, status: artifact.status });
}

export function formatSarif(result: ReportInput): string {
  const results: SarifResult[] = result.findings.filter((f) => f.messageId !== "missing").map((f) => {
    if (f.commit || f.change) throw new Error("commit subjects require JSON rather than physical SARIF file locations");
    if (!Number.isSafeInteger(f.line) || f.line < 1 || !Number.isSafeInteger(f.endLine) || f.endLine < f.line) throw new Error("SARIF requires valid source ranges");
    return { ruleId: f.ruleKey ?? f.rule, level: f.severity === "error" ? "error" : f.severity === "warning" ? "warning" : "note",
      message: { text: f.message ?? f.ask ?? f.rule }, locations: [{ physicalLocation: physical({ path: f.file, startLine: f.line, endLine: f.endLine }) }] };
  });
  const complete = !result.dryRun && !result.errors?.length && result.stats.missing === 0 && !result.batches?.some((b) => b.degraded) && !result.unpaired?.subjects && !result.undeclared?.length
    && !result.commits?.noInstructionDoc && !result.all.some((f) => !!f.cut);
  return JSON.stringify(log(results, complete, { status: complete ? "complete" : "partial" }), null, 2);
}
