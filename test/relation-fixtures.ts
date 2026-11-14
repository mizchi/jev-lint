import { relationDigest, type RelationInput } from "../src/relation-contract.ts";

export function relationInputOf(): RelationInput {
  const specification = "Raw payloads must be deleted after 30 days.";
  const code = "export const retentionDays = 90;";
  return { schema: "jev-lint-relations-input-1", repository: "example/service", sourceSha: "a".repeat(40), runId: "run-00001",
    sources: [
      { id: "contract", path: "docs/contract.md", ref: "b".repeat(40), kind: "documentation", authority: "approved", content: specification,
        contentHash: relationDigest(specification), scope: ["src", "docs"], approval: { id: "decision-001", revision: 1, digest: "c".repeat(64) } },
      { id: "code", path: "src/retention.ts", ref: "a".repeat(40), kind: "code", authority: "observed", content: code,
        contentHash: relationDigest(code), scope: [], approval: null },
    ],
    claims: [{ id: "retention", statement: "Raw payloads must be deleted after 30 days.", evidence: [{ sourceId: "contract", startLine: 1, endLine: 1, quote: specification }] }],
    expectedClaimIds: ["retention"],
    relations: [{ id: "retention-code", subject: "relation", claimId: "retention", targets: [{ sourceId: "code", startLine: 1, endLine: 1, quote: code }], context: [] }],
  };
}
