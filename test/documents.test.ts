import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Jev } from "../src/jev.ts";
import { prepareDocuments, scanDocuments, replayDocuments, loadDocumentLedger, parseDocumentReport, documentExitCode, documentJudgmentKey, DOCUMENT_QUESTION_DIGEST, type DocumentManifest, type DocumentReport } from "../src/documents.ts";
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

await testAsync("documents: a ledger answers unchanged excerpts without asking, whatever else changed", async () => {
  const f = fixture();
  try {
    const dir = join(f.cwd, "judgments");
    const first = loadDocumentLedger(dir), client = clientOf();
    const report = await scanDocuments(prepareDocuments(f.manifest, { cwd: f.cwd }), { client, ledger: first });
    assert.equal(client.spent.calls, 1); assert.equal(report.coverage.reused, 0); assert.ok(first.flush());

    // Lines added above the compared section move its line numbers but not its text.
    writeFileSync(join(f.cwd, "guide.md"), "# Guide\n\nAn unrelated new paragraph.\n\n```md\n## Runtime\nexample only\n```\n\n## Runtime\n\nNode 22 or later is required.\n");
    const warm = clientOf("supports"), again = await scanDocuments(prepareDocuments(f.manifest, { cwd: f.cwd }), { client: warm, ledger: loadDocumentLedger(dir) });
    assert.equal(warm.spent.calls, 0, "a recorded answer is reused, not re-rolled");
    assert.equal(again.coverage.reused, 1); assert.equal(again.coverage.contradictions, 1);
    assert.equal(again.candidates[0].target.startLine, 10, "the report still cites the current location");

    writeFileSync(join(f.cwd, "guide.md"), "# Guide\n\n## Runtime\n\nNode 24 or later is required.\n");
    const changed = clientOf("supports"), fresh = await scanDocuments(prepareDocuments(f.manifest, { cwd: f.cwd }), { client: changed, ledger: loadDocumentLedger(dir) });
    assert.equal(changed.spent.calls, 1, "a changed excerpt is a new question"); assert.equal(fresh.coverage.contradictions, 0);
  } finally { f.close(); }
});

await testAsync("documents: resampling asks again and the newer answer wins; replay asks nothing and marks the unrecorded", async () => {
  const f = fixture();
  try {
    const dir = join(f.cwd, "judgments"), input = prepareDocuments(f.manifest, { cwd: f.cwd });
    const empty = replayDocuments(input, loadDocumentLedger(dir));
    assert.equal(empty.candidates[0].judgment, null); assert.deepEqual(empty.errors, [{ comparisonId: "runtime", code: "unrecorded" }]);
    assert.equal(empty.status, "failed"); assert.equal(documentExitCode(empty), 3);

    const ledger = loadDocumentLedger(dir);
    await scanDocuments(input, { client: clientOf("contradicts"), ledger }); ledger.flush();
    const again = loadDocumentLedger(dir), client = clientOf("supports");
    await scanDocuments(input, { client, ledger: again, resample: true }); again.flush();
    assert.equal(client.spent.calls, 1);
    const replayed = replayDocuments(input, loadDocumentLedger(dir));
    assert.equal(replayed.candidates[0].judgment?.choice, "supports"); assert.equal(replayed.status, "complete");
    assert.equal(replayed.usage.requests, 0); assert.equal(documentExitCode(replayed), 0);
  } finally { f.close(); }
});

test("documents: the judgment key covers what the model compares, not where it sits", () => {
  const f = fixture();
  try {
    const [c] = prepareDocuments(f.manifest, { cwd: f.cwd }).comparisons;
    const key = documentJudgmentKey(c, DOCUMENT_QUESTION_DIGEST, "m");
    assert.match(key, /^[a-f0-9]{64}$/);
    assert.equal(documentJudgmentKey({ ...c, target: { ...c.target, startLine: 99, endLine: 101 } }, DOCUMENT_QUESTION_DIGEST, "m"), key);
    for (const other of [
      documentJudgmentKey({ ...c, target: { ...c.target, contentHash: "0".repeat(64) } }, DOCUMENT_QUESTION_DIGEST, "m"),
      documentJudgmentKey({ ...c, topic: "other" }, DOCUMENT_QUESTION_DIGEST, "m"),
      documentJudgmentKey(c, "0".repeat(64), "m"),
      documentJudgmentKey(c, DOCUMENT_QUESTION_DIGEST, "other-model"),
    ]) assert.notEqual(other, key);
  } finally { f.close(); }
});

await testAsync("documents: a report recorded before ledgers validates as one that reused nothing", async () => {
  const f = fixture();
  try {
    const input = prepareDocuments(f.manifest, { cwd: f.cwd }), report = await scanDocuments(input, { client: clientOf() });
    const { reused: _reused, ...coverage } = report.coverage;
    const older = { ...structuredClone(report), coverage };
    assert.deepEqual(parseDocumentReport(older, input), report);
    const claimed = structuredClone(report); claimed.coverage.reused = 2;
    assert.throws(() => parseDocumentReport(claimed, input), "a report cannot reuse more than it answered");
  } finally { f.close(); }
});
