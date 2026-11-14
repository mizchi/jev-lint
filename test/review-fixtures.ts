import { digest, type ScanResultV1 } from "../src/scan-contract.ts";

export function scanArtifact(): ScanResultV1 {
  const evidence = "export function value() { return 1; }";
  return { schema: "jev-lint-scan-1", repository: "example/service", sourceSha: "a".repeat(40), runId: "review-001", status: "complete", policy: null,
    engine: { questionSchema: "jev-lint-questions-1", servedModel: "fixture" }, usage: { requests: 1, inputTokens: 10, usd: 0 },
    coverage: { matched: 1, answered: 1, missing: 0, omittedCandidates: 0, outsideDiff: 0, excludedFiles: 0, suppressed: 0, unpaired: 0,
      undeclaredLanguages: [], degradedBatches: 0, cutSubjects: 0, noInstructionDoc: 0, dryRun: false }, errors: [],
    candidates: [{ id: "b".repeat(64), rule: { id: "typescript/name", digest: "c".repeat(12) }, claim: "The name describes behavior.", evidence,
      source: { path: "src/a.ts", startLine: 1, endLine: 1, contentHash: digest(evidence) }, contextHash: "d".repeat(64),
      disposition: "reported", judgment: { kind: "noul", value: 0.9, maximum: 1, confidence: null, threshold: 0.7 } }],
  };
}
