import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../src/cli/main.ts";
import { Jev } from "../src/jev.ts";
import { prepareDocuments, scanDocuments, type DocumentManifest } from "../src/documents.ts";
import { testAsync } from "./harness.ts";

await testAsync("cmd-docs: plans make no requests, a second run reuses the ledger, and replay asks nothing", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-docs-cli-")), previous = process.cwd();
  try {
    writeFileSync(join(cwd, "a.md"), "Node 24 is required."); writeFileSync(join(cwd, "b.md"), "Node 22 is required.");
    writeFileSync(join(cwd, "manifest.json"), JSON.stringify({ schema: "jev-lint-documents-manifest-1", files: { a: { path: "a.md", role: "reference" }, b: { path: "b.md", role: "document" } }, comparisons: [{ id: "runtime", topic: "Node floor", mode: "semantic", reference: { source: "a" }, target: { source: "b" } }] }));
    process.chdir(cwd); let output = "";
    const client = new Jev({ apiKey: "fixture", fetch: async () => Response.json({ model: "fixture", answers: { q0000: {
      type: "choice", choice: "contradicts", confidence: 1, probabilities: { supports: 0, contradicts: 1, unrelated: 0, insufficient_context: 0 },
    } } }) }), deps = { client, out: (s: string) => { output += s; }, log: () => {} };
    const args = ["docs", "--document-manifest", "manifest.json", "--json"];
    assert.equal(await main([...args, "--dry-run"], deps), 0); assert.equal(client.spent.calls, 0);
    output = ""; const live = await main(args, deps);
    assert.equal(live, 1); assert.equal(client.spent.calls, 1);
    assert.equal(readdirSync(join(cwd, ".jev-lint", "judgments")).length, 1, "one ledger file per run that learned something");
    output = ""; assert.equal(await main(args, deps), live); assert.equal(client.spent.calls, 1, "a second live run reuses the answer");
    assert.equal(JSON.parse(output).coverage.reused, 1);
    assert.equal(readdirSync(join(cwd, ".jev-lint", "judgments")).length, 1, "and writes nothing");
    output = ""; assert.equal(await main([...args, "--replay"], deps), live); assert.equal(client.spent.calls, 1);
    writeFileSync(join(cwd, "b.md"), "Node 24 is required.");
    output = ""; assert.equal(await main([...args, "--replay"], deps), 3);
    assert.deepEqual(JSON.parse(output).errors, [{ comparisonId: "runtime", code: "unrecorded" }]);
    assert.equal(client.spent.calls, 1);
    output = ""; assert.equal(await main([...args, "--resample", "--replay"], deps), 2, "resampling needs requests");
  } finally { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); }
});

await testAsync("cmd-docs: a 0.9 record given to --record or --replay is migrated into its ledger directory and removed", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-docs-cli-")), previous = process.cwd();
  try {
    writeFileSync(join(cwd, "a.md"), "Node 24 is required."); writeFileSync(join(cwd, "b.md"), "Node 22 is required.");
    const manifest = { schema: "jev-lint-documents-manifest-1", files: { a: { path: "a.md", role: "reference" }, b: { path: "b.md", role: "document" } }, comparisons: [{ id: "runtime", topic: "Node floor", mode: "semantic", reference: { source: "a" }, target: { source: "b" } }] };
    writeFileSync(join(cwd, "manifest.json"), JSON.stringify(manifest));
    process.chdir(cwd);
    const client = new Jev({ apiKey: "fixture", fetch: async () => Response.json({ model: "jev-1.14.0", answers: { q0000: {
      type: "choice", choice: "contradicts", confidence: 1, probabilities: { supports: 0, contradicts: 1, unrelated: 0, insufficient_context: 0 },
    } } }) });
    const legacy = await scanDocuments(prepareDocuments(manifest as DocumentManifest, { cwd }), { client });
    writeFileSync(join(cwd, "docs.record.json"), JSON.stringify(legacy, null, 2));
    let output = "", logs = "";
    const deps = { client, out: (s: string) => { output += s; }, log: (s: string) => { logs += `${s}\n`; } };
    const code = await main(["docs", "--document-manifest", "manifest.json", "--json", "--replay", "docs.record.json"], deps);
    assert.equal(code, 1); assert.equal(client.spent.calls, 1, "the migrated answer replays with no request");
    assert.ok(!existsSync(join(cwd, "docs.record.json"))); assert.ok(existsSync(join(cwd, "docs")));
    assert.match(logs, /deprecated.*--ledger docs/s); assert.match(logs, /removed in 0\.13\.0/);
    output = ""; assert.equal(await main(["docs", "--document-manifest", "manifest.json", "--json", "--replay", "--ledger", "docs"], deps), 1);
  } finally { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); }
});

await testAsync("cmd-docs: invalid destinations send nothing and manifest changes revoke the snapshot", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-docs-cli-")), previous = process.cwd();
  try {
    writeFileSync(join(cwd, "a.md"), "Node 24 is required."); writeFileSync(join(cwd, "b.md"), "Node 24 is required.");
    const manifest = { schema: "jev-lint-documents-manifest-1", files: { a: { path: "a.md", role: "reference" }, b: { path: "b.md", role: "document" } }, comparisons: [{ id: "runtime", topic: "Node floor", mode: "semantic", reference: { source: "a" }, target: { source: "b" } }] };
    const path = join(cwd, "manifest.json"); writeFileSync(path, JSON.stringify(manifest));
    process.chdir(cwd); let output = "";
    const client = new Jev({ apiKey: "fixture", fetch: async () => {
      manifest.comparisons[0].topic = "A different claim"; writeFileSync(path, JSON.stringify(manifest));
      return Response.json({ model: "fixture", answers: { q0000: { type: "choice", choice: "supports", confidence: 1,
        probabilities: { supports: 1, contradicts: 0, unrelated: 0, insufficient_context: 0 } } } });
    } }), deps = { client, out: (s: string) => { output += s; }, log: () => {} };
    const args = ["docs", "--document-manifest", "manifest.json", "--json"];
    assert.equal(await main([...args, "--ledger", "a.md"], deps), 2); assert.equal(client.spent.calls, 0);
    assert.equal(await main([...args, "--sarif"], deps), 2); assert.equal(client.spent.calls, 0);
    assert.equal(await main(args, deps), 3); assert.equal(JSON.parse(output).snapshotChanged, true);
  } finally { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); }
});

await testAsync("cmd-docs: a legacy record that is itself a registered input is never migrated away", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-docs-cli-")), previous = process.cwd();
  try {
    writeFileSync(join(cwd, "a.md"), "Node 24 is required."); writeFileSync(join(cwd, "b.md"), "Node 22 is required.");
    const manifest = { schema: "jev-lint-documents-manifest-1", files: { a: { path: "a.md", role: "reference" }, b: { path: "b.md", role: "document" } }, comparisons: [{ id: "runtime", topic: "Node floor", mode: "semantic", reference: { source: "a" }, target: { source: "b" } }] };
    const client = new Jev({ apiKey: "fixture", fetch: async () => Response.json({ model: "jev-1.14.0", answers: { q0000: {
      type: "choice", choice: "supports", confidence: 1, probabilities: { supports: 1, contradicts: 0, unrelated: 0, insufficient_context: 0 } } } }) });
    const legacy = JSON.stringify(await scanDocuments(prepareDocuments(manifest as DocumentManifest, { cwd }), { client }));
    writeFileSync(join(cwd, "archive.record.json"), legacy);
    const registered = { ...manifest, files: { ...manifest.files, archive: { path: "archive.record.json", role: "historical" } } };
    writeFileSync(join(cwd, "manifest.json"), JSON.stringify(registered));
    process.chdir(cwd);
    const deps = { client, out: () => {}, log: () => {} };
    for (const flag of [["--record", "archive.record.json"], ["--replay", "archive.record.json"]]) {
      assert.equal(await main(["docs", "--document-manifest", "manifest.json", ...flag], deps), 2, flag.join(" "));
      assert.equal(readFileSync(join(cwd, "archive.record.json"), "utf8"), legacy);
    }
    assert.ok(!existsSync(join(cwd, "archive")));
  } finally { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); }
});
