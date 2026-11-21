import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Jev } from "../src/jev.ts";
import { Cache } from "../src/cache.ts";
import { prepareDocuments, scanDocuments, replayDocuments, loadDocumentLedger, type DocumentManifest } from "../src/documents.ts";
import { LEGACY_MIGRATION, legacyCacheDir, legacyRecordDir, migrateLegacyFile } from "../src/legacy-ledger.ts";
import { test, testAsync } from "./harness.ts";

const semver = (v: string) => v.split(".").map(Number);
const atLeast = (v: string, floor: string) => { const [a, b] = [semver(v), semver(floor)]; for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return true; };

test("legacy-ledger: the migrator is removed by the release it announces", () => {
  // The announcement promises the 0.9 stores are read until LEGACY_MIGRATION.removeIn.
  // When the package reaches that version this fails: delete src/legacy-ledger.ts,
  // its callers, this file, and the CHANGELOG notice that points at it.
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  assert.ok(!atLeast(version, LEGACY_MIGRATION.removeIn), `jev-lint ${version} still ships the 0.9 migrator scheduled for removal in ${LEGACY_MIGRATION.removeIn}`);
  assert.ok(atLeast(LEGACY_MIGRATION.removeIn, LEGACY_MIGRATION.since));
});

test("legacy-ledger: legacy paths map to their ledger directories", () => {
  assert.equal(legacyCacheDir("/p/.jev-lint/baseline.json"), "/p/.jev-lint/verdicts");
  assert.equal(legacyCacheDir("/p/.jev-lint/baseline.openrouter-0123456789ab.json"), "/p/.jev-lint/verdicts.openrouter-0123456789ab");
  assert.equal(legacyCacheDir("/p/cache/mine.json"), "/p/cache/mine");
  assert.equal(legacyCacheDir("/p/.jev-lint/verdicts"), null, "a directory path is not legacy");
  assert.equal(legacyRecordDir("/p/.jev-lint/checklists/rtla.record.json"), "/p/.jev-lint/checklists/rtla");
  assert.equal(legacyRecordDir("/p/docs.json"), "/p/docs");
});

test("legacy-ledger: a 0.9 verdict cache becomes one ledger file, keeps every verdict and is removed", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-legacy-"));
  try {
    const file = join(dir, "baseline.json");
    writeFileSync(file, JSON.stringify({ schema: "jev-lint-cache-4", model: "m", entries: {
      aaaaaaaaaaaaaaaaaaaaaaaa: { value: 2, confidence: 0.5, kind: "score", rule: "r", at: "2026-11-01T00:00:00.000Z" },
      bbbbbbbbbbbbbbbbbbbbbbbb: { value: 0.1, confidence: null, kind: "noul" },
    } }));
    const result = migrateLegacyFile(file);
    assert.equal(result.kind, "cache"); assert.equal(result.migrated, 2); assert.equal(result.removed, true);
    assert.equal(result.to, join(dir, "verdicts"));
    assert.ok(!existsSync(file));
    const cache = Cache.load(join(dir, "verdicts"));
    assert.equal(cache.loadError, null);
    assert.deepEqual(cache.get("aaaaaaaaaaaaaaaaaaaaaaaa", "score"), { value: 2, confidence: 0.5, kind: "score" });
    assert.ok(cache.get("bbbbbbbbbbbbbbbbbbbbbbbb", "noul"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("legacy-ledger: an older cache schema, a foreign file and a dry run change nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-legacy-"));
  try {
    const old = join(dir, "baseline.json"), foreign = join(dir, "other.json");
    writeFileSync(old, JSON.stringify({ schema: "jev-lint-2", entries: { k: { value: 1, kind: "noul" } } }));
    writeFileSync(foreign, JSON.stringify({ hello: 1 }));
    assert.equal(migrateLegacyFile(old).kind, "unsupported");
    assert.equal(migrateLegacyFile(foreign).kind, "unsupported");
    writeFileSync(old, JSON.stringify({ schema: "jev-lint-cache-4", entries: { aaaaaaaaaaaaaaaaaaaaaaaa: { value: 1, kind: "noul" } } }));
    const dry = migrateLegacyFile(old, { dryRun: true });
    assert.equal(dry.migrated, 1); assert.equal(dry.removed, false);
    assert.ok(existsSync(old)); assert.ok(!existsSync(join(dir, "verdicts")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await testAsync("legacy-ledger: a 0.9 document record answers the same comparisons from the ledger, and loses to any fresh answer", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-legacy-docs-"));
  try {
    writeFileSync(join(cwd, "a.md"), "Node 24 is required."); writeFileSync(join(cwd, "b.md"), "Node 22 is required.");
    const manifest: DocumentManifest = { schema: "jev-lint-documents-manifest-1", files: { a: { path: "a.md", role: "reference" }, b: { path: "b.md", role: "document" } }, comparisons: [{ id: "runtime", topic: "Node floor", mode: "semantic", reference: { source: "a" }, target: { source: "b" } }] };
    const input = prepareDocuments(manifest, { cwd });
    const client = new Jev({ apiKey: "fixture", fetch: async () => Response.json({ model: "jev-1.14.0", answers: { q0000: { type: "choice", choice: "contradicts", confidence: 1, probabilities: { supports: 0, contradicts: 1, unrelated: 0, insufficient_context: 0 } } } }) });
    const record = join(cwd, "docs.record.json");
    writeFileSync(record, JSON.stringify(await scanDocuments(input, { client }), null, 2));

    const result = migrateLegacyFile(record);
    assert.equal(result.kind, "documents"); assert.equal(result.migrated, 1); assert.equal(result.to, join(cwd, "docs"));
    assert.ok(!existsSync(record));
    const replayed = replayDocuments(input, loadDocumentLedger(join(cwd, "docs")), { model: "jev-1.14.0" });
    assert.equal(replayed.candidates[0].judgment?.choice, "contradicts"); assert.equal(replayed.status, "complete");

    const ledger = loadDocumentLedger(join(cwd, "docs"));
    const fresh = new Jev({ apiKey: "fixture", model: "jev-1.14.0", fetch: async () => Response.json({ model: "jev-1.14.0", answers: { q0000: { type: "choice", choice: "supports", confidence: 1, probabilities: { supports: 1, contradicts: 0, unrelated: 0, insufficient_context: 0 } } } }) });
    await scanDocuments(input, { client: fresh, ledger, resample: true }); ledger.flush();
    assert.equal(replayDocuments(input, loadDocumentLedger(join(cwd, "docs")), { model: "jev-1.14.0" }).candidates[0].judgment?.choice, "supports");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
