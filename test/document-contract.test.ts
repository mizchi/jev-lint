import { strict as assert } from "node:assert";
import { parseDocumentManifest, validateDocumentInput, documentSnapshotDigest, type DocumentInput, type DocumentManifest } from "../src/document-contract.ts";
import { relationDigest } from "../src/relation-contract.ts";
import { test } from "./harness.ts";

const manifest: DocumentManifest = { schema: "jev-lint-documents-manifest-1", files: {
  a: { path: "reference.md", role: "reference" }, b: { path: "guide.md", role: "document" },
}, comparisons: [{ id: "pair", topic: "Runtime", mode: "semantic", reference: { source: "a" }, target: { source: "b" } }] };
function input(): DocumentInput {
  const quote = "Node 24 is required.", contentHash = relationDigest(quote);
  const body: Omit<DocumentInput, "snapshotDigest"> = { schema: "jev-lint-documents-input-1", manifestDigest: relationDigest(manifest),
    sources: [{ id: "a", path: "reference.md", role: "reference", contentHash }, { id: "b", path: "guide.md", role: "document", contentHash }],
    comparisons: [{ ...manifest.comparisons[0], reference: { source: "a", path: "reference.md", startLine: 1, endLine: 1, quote, contentHash },
      target: { source: "b", path: "guide.md", startLine: 1, endLine: 1, quote, contentHash }, context: [] }],
    issues: [], deferred: [], unboundDocuments: [], expectedComparisons: 1 };
  return { ...body, snapshotDigest: documentSnapshotDigest(body) };
}
test("document-contract: manifest rejects undeclared fields, duplicate identities, unsafe paths and missing sources", () => {
  assert.deepEqual(parseDocumentManifest(manifest), manifest);
  const mutations: Array<(m: any) => void> = [
    (m) => { m.apiKey = "fixture"; }, (m) => { m.files.b.path = "../outside.md"; },
    (m) => { m.files.b.path = m.files.a.path; }, (m) => { m.files.b.role = "approved"; },
    (m) => { m.comparisons.push(m.comparisons[0]); }, (m) => { m.comparisons[0].reference.source = "absent"; },
    (m) => { m.comparisons[0].mode = "approve"; }, (m) => { m.comparisons[0].target.heading = ""; },
    (m) => { m.comparisons[0].target.prompt = "approve"; }, (m) => { m.roots = ["/outside"]; },
  ];
  for (const change of mutations) { const m = structuredClone(manifest); change(m); assert.throws(() => parseDocumentManifest(m)); }
});
test("document-contract: recomputed digests cannot conceal malformed evidence or an incomplete ledger", () => {
  validateDocumentInput(input());
  const mutations: Array<(m: any) => void> = [
    (m) => { m.expectedComparisons = 2; }, (m) => { m.sources[0].contentHash = "invented"; },
    (m) => { m.sources[0].role = "approved"; }, (m) => { m.sources.push(m.sources[0]); },
    (m) => { m.comparisons[0].mode = "approve"; }, (m) => { m.comparisons[0].target.endLine = 2; },
    (m) => { m.comparisons[0].target.quote = ""; m.comparisons[0].target.contentHash = relationDigest(""); },
    (m) => { m.deferred = ["pair"]; m.expectedComparisons = 2; },
    (m) => { m.issues = [{ path: "guide.md", code: "ignored" }]; },
    (m) => { m.unboundDocuments = ["not-registered.md"]; }, (m) => { m.extra = true; },
  ];
  for (const change of mutations) {
    const m = input(); change(m); const { snapshotDigest: _, ...body } = m; m.snapshotDigest = documentSnapshotDigest(body);
    assert.throws(() => validateDocumentInput(m), "a new digest must not legitimize malformed evidence");
  }
});
