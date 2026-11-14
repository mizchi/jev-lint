import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Jev } from "../src/jev.ts";
import { prepareDocuments, scanDocuments, parseDocumentReport, documentExitCode, type DocumentManifest, type DocumentReport } from "../src/documents.ts";
import { testAsync, test } from "./harness.ts";

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "jev-docs-"));
  writeFileSync(join(cwd, "reference.md"), "# Contract\n\n## Runtime\n\nNode 24 or later is required.\n");
  writeFileSync(join(cwd, "guide.md"), "# Guide\n\n```md\n## Runtime\nexample only\n```\n\n## Runtime\n\nNode 22 or later is required.\n");
  const manifest: DocumentManifest = { schema: "jev-lint-documents-manifest-1", files: {
    reference: { path: "reference.md", role: "reference" }, guide: { path: "guide.md", role: "document" },
  }, comparisons: [{ id: "runtime", topic: "Minimum supported Node version", mode: "semantic", reference: { source: "reference", heading: "Runtime" }, target: { source: "guide", heading: "Runtime" } }] };
  return { cwd, manifest, close: () => rmSync(cwd, { recursive: true, force: true }) };
}
function clientOf(choice = "contradicts", beforeSend?: () => Promise<void>) {
  return new Jev({ apiKey: "fixture", beforeSend, fetch: async () => Response.json({ model: "fixture", answers: { q0000: {
    type: "choice", choice, confidence: 1, probabilities: { supports: 0, contradicts: 0, unrelated: 0, insufficient_context: 0, [choice]: 1 },
  } }, usage: { input_tokens: 10 } }) });
}

test("documents: selectors ignore headings in fenced examples and retain exact source locations", () => {
  const f = fixture();
  try {
    const input = prepareDocuments(f.manifest, { cwd: f.cwd });
    assert.equal(input.comparisons.length, 1); assert.equal(input.issues.length, 0);
    assert.equal(input.comparisons[0].target.startLine, 8);
    assert.ok(!input.comparisons[0].target.quote.includes("example only"));
    const outside = structuredClone(f.manifest); outside.files.guide.path = "../outside.md";
    assert.throws(() => prepareDocuments(outside, { cwd: f.cwd }), /manifest/);
  } finally { f.close(); }
});

await testAsync("documents: disagreements retain citations and replay rejects altered excerpts and stale sources", async () => {
  const f = fixture();
  try {
    const input = prepareDocuments(f.manifest, { cwd: f.cwd }), report = await scanDocuments(input, { client: clientOf() });
    assert.equal(report.status, "complete"); assert.equal(report.coverage.contradictions, 1);
    assert.equal(report.candidates[0].target.path, "guide.md");
    assert.deepEqual(parseDocumentReport(report, input), report);
    const forged = structuredClone(report); forged.candidates[0].target.quote = "invented text";
    assert.throws(() => parseDocumentReport(forged, input));
    writeFileSync(join(f.cwd, "guide.md"), "# Runtime\nNode 24 or later is required.");
    assert.throws(() => parseDocumentReport(report, prepareDocuments(f.manifest, { cwd: f.cwd })), /document report/);
  } finally { f.close(); }
});

await testAsync("documents: missing, ambiguous, unbound and budget-excluded inputs are not clean results", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.cwd, "guide.md"), "## Runtime\nOne\n## Runtime\nTwo\n");
    const input = prepareDocuments(f.manifest, { cwd: f.cwd });
    assert.ok(input.issues.some((i) => i.code === "ambiguous-selector"));
    assert.equal((await scanDocuments(input, { client: clientOf("supports") })).status, "partial");
    const limited = prepareDocuments(f.manifest, { cwd: f.cwd, maxComparisons: 0 });
    assert.ok(limited.deferred.length || limited.issues.length);
    const hidden = structuredClone(f.manifest); hidden.files.extra = { path: "extra.md", role: "document" };
    writeFileSync(join(f.cwd, "extra.md"), "Unknown requirement.");
    assert.ok(prepareDocuments(hidden, { cwd: f.cwd }).unboundDocuments.includes("extra.md"));
    rmSync(join(f.cwd, "guide.md")); symlinkSync("reference.md", join(f.cwd, "guide.md"));
    assert.ok(prepareDocuments(f.manifest, { cwd: f.cwd }).issues.some((i) => i.code === "source-unavailable"));
  } finally { f.close(); }
});

await testAsync("documents: revoked sends and answered uncertainty remain distinguishable from agreement", async () => {
  const f = fixture();
  try {
    const input = prepareDocuments(f.manifest, { cwd: f.cwd });
    const failed = await scanDocuments(input, { client: clientOf("supports", async () => { throw new Error("revoked"); }) });
    assert.equal(failed.status, "failed"); assert.equal(failed.coverage.missing, 1);
    const uncertain = await scanDocuments(input, { client: clientOf("insufficient_context") });
    assert.equal(uncertain.status, "partial"); assert.equal(uncertain.coverage.unassessed, 1);
  } finally { f.close(); }
});

await testAsync("documents: replay rejects tampered counters, identity, probabilities, coverage and error ledgers", async () => {
  const f = fixture();
  try {
    const input = prepareDocuments(f.manifest, { cwd: f.cwd }), report = await scanDocuments(input, { client: clientOf() });
    const mutations: Array<(r: DocumentReport) => void> = [
      (r) => { r.coverage.contradictions = 0; }, (r) => { r.coverage.expected++; }, (r) => { r.questionDigest = "0".repeat(64); },
      (r) => { r.candidates[0].candidateId = "0".repeat(64); }, (r) => { r.candidates[0].contextHash = "0".repeat(64); },
      (r) => { r.candidates = []; }, (r) => { r.candidates[0].judgment!.probabilities!.contradicts = 0.1; },
      (r) => { r.usage.requests = -1; }, (r) => { r.errors = [{ comparisonId: "runtime", code: "request-failed" }]; },
      (r) => { r.status = "partial"; },
    ];
    for (const change of mutations) { const r = structuredClone(report); change(r); assert.throws(() => parseDocumentReport(r, input)); }
    const stale = await scanDocuments(input, { client: clientOf(), snapshotCheck: () => false });
    assert.equal(stale.coverage.contradictions, 1); assert.equal(stale.status, "partial"); assert.equal(documentExitCode(stale), 3);
    assert.deepEqual(parseDocumentReport(stale, input), stale);
  } finally { f.close(); }
});

await testAsync("documents: malformed answers produce missing judgments rather than a clean result", async () => {
  const f = fixture();
  try {
    const input = prepareDocuments(f.manifest, { cwd: f.cwd });
    const client = new Jev({ apiKey: "fixture", fetch: async () => Response.json({ answers: { q0000: { type: "choice", choice: "supports", confidence: 1 } } }) });
    const report = await scanDocuments(input, { client });
    assert.equal(report.status, "failed"); assert.equal(report.candidates[0].judgment, null);
    assert.equal(report.errors[0].code, "unusable-answer"); assert.equal(documentExitCode(report), 3);
    assert.deepEqual(parseDocumentReport(report, input), report);
  } finally { f.close(); }
});
