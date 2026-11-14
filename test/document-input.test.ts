import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareDocuments } from "../src/document-input.ts";
import { validateDocumentInput, type DocumentManifest } from "../src/document-contract.ts";
import { test } from "./harness.ts";

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "jev-document-input-"));
  writeFileSync(join(cwd, "a.md"), "# Rules\n\n## Runtime\n\nNode 24 is required.\n\n## Other\n\nExample.\n");
  writeFileSync(join(cwd, "b.md"), "# Runtime\n\nNode 24 is required.\n");
  const manifest: DocumentManifest = { schema: "jev-lint-documents-manifest-1", roots: ["."], files: {
    a: { path: "a.md", role: "reference" }, b: { path: "b.md", role: "document" },
  }, comparisons: [{ id: "runtime", topic: "Node floor", mode: "semantic", reference: { source: "a", heading: "Runtime", contains: "Node 24" }, target: { source: "b" } }] };
  return { cwd, manifest, close: () => rmSync(cwd, { recursive: true, force: true }) };
}
test("document-input: selects a unique paragraph with exact lines and discovers undeclared documentation", () => {
  const f = fixture();
  try {
    const first = prepareDocuments(f.manifest, { cwd: f.cwd }); validateDocumentInput(first);
    assert.equal(first.comparisons[0].reference.quote, "Node 24 is required.");
    assert.equal(first.comparisons[0].reference.startLine, 5); assert.equal(first.comparisons[0].reference.endLine, 5);
    writeFileSync(join(f.cwd, "new.mdx"), "New requirement.");
    const changed = prepareDocuments(f.manifest, { cwd: f.cwd }); validateDocumentInput(changed);
    assert.ok(changed.issues.some((i) => i.path === "new.mdx" && i.code === "unregistered-document"));
    assert.notEqual(changed.snapshotDigest, first.snapshotDigest);
  } finally { f.close(); }
});
test("document-input: missing inventory roots remain visible rather than certifying an empty inventory", () => {
  const f = fixture();
  try {
    f.manifest.roots = ["missing-docs"];
    const input = prepareDocuments(f.manifest, { cwd: f.cwd });
    assert.ok(input.issues.some((i) => i.path === "missing-docs" && i.code === "inventory-unavailable"));
    validateDocumentInput(input);
  } finally { f.close(); }
});
test("document-input: missing selectors, excerpt budgets and deferred comparisons preserve omissions", () => {
  const f = fixture();
  try {
    f.manifest.comparisons[0].reference.contains = "absent";
    const missing = prepareDocuments(f.manifest, { cwd: f.cwd }); validateDocumentInput(missing);
    assert.equal(missing.comparisons.length, 0); assert.ok(missing.issues.some((i) => i.code === "missing-selector"));
    delete f.manifest.comparisons[0].reference.contains;
    const oversized = prepareDocuments(f.manifest, { cwd: f.cwd, maxExcerptChars: 5 }); validateDocumentInput(oversized);
    assert.ok(oversized.issues.some((i) => i.code === "excerpt-budget"));
    const deferred = prepareDocuments(f.manifest, { cwd: f.cwd, maxComparisons: 0 }); validateDocumentInput(deferred);
    assert.deepEqual(deferred.deferred, ["runtime"]);
    assert.throws(() => prepareDocuments(f.manifest, { cwd: f.cwd, maxComparisons: -1 }));
  } finally { f.close(); }
});
test("document-input: refuses symlink parents and does not use context-only bindings as document coverage", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.cwd, "real")); writeFileSync(join(f.cwd, "real/c.md"), "Context.");
    symlinkSync("real", join(f.cwd, "linked"));
    f.manifest.files.c = { path: "linked/c.md", role: "document" };
    f.manifest.comparisons[0].context = [{ source: "c" }];
    const input = prepareDocuments(f.manifest, { cwd: f.cwd }); validateDocumentInput(input);
    assert.ok(input.issues.some((i) => i.path === "linked/c.md" && i.code === "source-unavailable"));
    assert.ok(input.unboundDocuments.includes("linked/c.md"));
  } finally { f.close(); }
});
