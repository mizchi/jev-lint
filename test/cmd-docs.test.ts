import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../src/cli/main.ts";
import { Jev } from "../src/jev.ts";
import { testAsync } from "./harness.ts";

await testAsync("cmd-docs: plans make no requests and replay cannot reuse answers after a document changes", async () => {
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
    output = ""; const live = await main([...args, "--record", "record.json"], deps);
    assert.equal(live, 1); const calls = client.spent.calls; assert.equal(calls, 1);
    output = ""; assert.equal(await main([...args, "--replay", "record.json"], deps), live); assert.equal(client.spent.calls, calls);
    writeFileSync(join(cwd, "b.md"), "Node 24 is required.");
    output = ""; assert.equal(await main([...args, "--replay", "record.json"], deps), 3); assert.equal(JSON.parse(output).status, "stale");
    assert.equal(client.spent.calls, calls);
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
    assert.equal(await main([...args, "--record", "a.md"], deps), 2); assert.equal(client.spent.calls, 0);
    assert.equal(await main([...args, "--sarif"], deps), 2); assert.equal(client.spent.calls, 0);
    assert.equal(await main(args, deps), 3); assert.equal(JSON.parse(output).snapshotChanged, true);
  } finally { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); }
});
