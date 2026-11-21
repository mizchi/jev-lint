import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../src/cli/main.ts";
import { Jev } from "../src/jev.ts";
import { Cache } from "../src/cache.ts";
import { loadDocumentLedger, prepareDocuments, replayDocuments, scanDocuments, type DocumentManifest } from "../src/documents.ts";
import { testAsync } from "./harness.ts";

const answering = (choice: string) => new Jev({ apiKey: "fixture", fetch: async () => Response.json({ model: "jev-1.14.0", answers: { q0000: {
  type: "choice", choice, confidence: 1, probabilities: { supports: 0, contradicts: 0, unrelated: 0, insufficient_context: 0, [choice]: 1 },
} } }) });
const manifest: DocumentManifest = { schema: "jev-lint-documents-manifest-1", files: { a: { path: "a.md", role: "reference" }, b: { path: "b.md", role: "document" } },
  comparisons: [{ id: "runtime", topic: "Node floor", mode: "semantic", reference: { source: "a" }, target: { source: "b" } }] };

async function inProject(run: (cwd: string, cli: (args: string[]) => Promise<{ code: number; out: string; log: string }>) => Promise<void>) {
  const cwd = mkdtempSync(join(tmpdir(), "jev-ledger-cli-")), previous = process.cwd();
  try {
    process.chdir(cwd);
    writeFileSync(join(cwd, ".jev-lint.yaml"), "{}\n");
    writeFileSync(join(cwd, "a.md"), "Node 24 is required."); writeFileSync(join(cwd, "b.md"), "Node 22 is required.");
    writeFileSync(join(cwd, "manifest.json"), JSON.stringify(manifest));
    await run(cwd, async (args) => {
      let out = "", log = "";
      const code = await main(args, { client: answering("contradicts"), out: (s) => { out += `${s}\n`; }, log: (s) => { log += `${s}\n`; } });
      return { code, out, log };
    });
  } finally { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); }
}

await testAsync("cmd-ledger: migrate finds every 0.9 store under .jev-lint, and a dry run changes nothing", async () => {
  await inProject(async (cwd, cli) => {
    mkdirSync(join(cwd, ".jev-lint", "checklists"), { recursive: true });
    writeFileSync(join(cwd, ".jev-lint", "baseline.json"), JSON.stringify({ schema: "jev-lint-cache-4", entries: { aaaaaaaaaaaaaaaaaaaaaaaa: { value: 1, kind: "noul" } } }));
    const record = join(cwd, ".jev-lint", "checklists", "core.record.json");
    writeFileSync(record, JSON.stringify(await scanDocuments(prepareDocuments(manifest, { cwd }), { client: answering("contradicts") })));
    writeFileSync(join(cwd, ".jev-lint", "checklists", "core.manifest.json"), JSON.stringify(manifest));

    const tree = () => readdirSync(cwd, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
      .map((e) => { const p = join(e.parentPath, e.name); return `${p}\0${readFileSync(p, "utf8")}`; }).sort();
    const before = tree();
    const dry = await cli(["ledger", "migrate", "--dry-run", "--json"]);
    assert.equal(dry.code, 0, dry.log);
    assert.equal(JSON.parse(dry.out).results.length, 2, "the manifest is not a store and is not listed");
    assert.deepEqual(tree(), before, "a dry run neither removes a source nor creates a destination");

    const done = await cli(["ledger", "migrate", "--json"]);
    assert.equal(done.code, 0, done.log);
    assert.ok(!existsSync(record) && !existsSync(join(cwd, ".jev-lint", "baseline.json")));
    assert.ok(Cache.load(join(cwd, ".jev-lint", "verdicts")).get("aaaaaaaaaaaaaaaaaaaaaaaa", "noul"));
    const replayed = replayDocuments(prepareDocuments(manifest, { cwd }), loadDocumentLedger(join(cwd, ".jev-lint", "checklists", "core")), { model: "jev-1.14.0" });
    assert.equal(replayed.status, "complete");
    assert.equal((await cli(["ledger", "migrate"])).code, 0, "nothing left to migrate is not a failure");

    writeFileSync(join(cwd, "odd.json"), JSON.stringify({ schema: "jev-lint-2", entries: {} }));
    assert.equal((await cli(["ledger", "migrate", "odd.json"])).code, 3, "a named file that cannot be converted is not a clean result");
  });
});

await testAsync("cmd-ledger: compact keeps one file of the manifest's live answers, and refuses to prune an incomplete snapshot", async () => {
  await inProject(async (cwd, cli) => {
    const docs = ["docs", "--document-manifest", "manifest.json", "--yes"];
    assert.equal((await cli(docs)).code, 1);
    writeFileSync(join(cwd, "b.md"), "Node 24 is required.");
    assert.equal((await cli(docs)).code, 1);
    const dir = join(cwd, ".jev-lint", "judgments");
    assert.equal(readdirSync(dir).length, 2);

    const plan = await cli(["ledger", "compact", "--document-manifest", "manifest.json", "--dry-run", "--json"]);
    assert.equal(plan.code, 0, plan.log);
    assert.deepEqual({ kept: JSON.parse(plan.out).kept, dropped: JSON.parse(plan.out).dropped }, { kept: 1, dropped: 1 });
    assert.equal(readdirSync(dir).length, 2, "a dry run writes nothing");

    const compacted = await cli(["ledger", "compact", "--document-manifest", "manifest.json", "--json"]);
    assert.equal(compacted.code, 0, compacted.log);
    assert.equal(readdirSync(dir).length, 1);
    assert.equal(replayDocuments(prepareDocuments(manifest, { cwd }), loadDocumentLedger(dir), { model: "jev-1.14.0" }).coverage.answered, 1);

    rmSync(join(cwd, "a.md"));
    assert.equal((await cli(["ledger", "compact", "--document-manifest", "manifest.json"])).code, 3, "a missing source would drop answers it cannot see");
    assert.equal(readdirSync(dir).length, 1);
  });
});

await testAsync("cmd-ledger: compact without a manifest folds the verdict cache and drops only duplicates", async () => {
  await inProject(async (cwd, cli) => {
    const path = join(cwd, ".jev-lint", "verdicts");
    for (const value of [1, 2]) { const c = Cache.load(path); c.set("aaaaaaaaaaaaaaaaaaaaaaaa", { value, confidence: null, kind: "noul" }); c.save(); }
    const c = Cache.load(path); c.set("bbbbbbbbbbbbbbbbbbbbbbbb", { value: 3, confidence: null, kind: "noul" }); c.save();
    assert.equal(readdirSync(path).length, 3);
    const result = await cli(["ledger", "compact", "--json"]);
    assert.equal(result.code, 0, result.log);
    assert.equal(JSON.parse(result.out).kept, 2);
    assert.equal(readdirSync(path).length, 1);
    assert.equal(Cache.load(path).get("aaaaaaaaaaaaaaaaaaaaaaaa", "noul")?.value, 2);
  });
});

await testAsync("cmd-ledger: replay and compaction key OpenRouter answers by the model id the scan recorded", async () => {
  await inProject(async (cwd) => {
    const routed = new Jev({ apiKey: "fixture", model: "typesafe/jev-1.14", fetch: async () => Response.json({ model: "typesafe/jev-1.14", answers: { q0000: {
      type: "choice", choice: "supports", confidence: 1, probabilities: { supports: 1, contradicts: 0, unrelated: 0, insufficient_context: 0 } } } }) });
    const dir = join(cwd, ".jev-lint", "judgments"), ledger = loadDocumentLedger(dir);
    await scanDocuments(prepareDocuments(manifest, { cwd }), { client: routed, ledger }); ledger.flush();
    const before = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "fixture";
    try {
      let out = "";
      const deps = { out: (s: string) => { out += s; }, log: () => {} };
      assert.equal(await main(["docs", "--document-manifest", "manifest.json", "--replay", "--model", "openrouter:typesafe/jev-1.14", "--json"], deps), 0, out);
      out = ""; assert.equal(await main(["ledger", "compact", "--document-manifest", "manifest.json", "--model", "openrouter:typesafe/jev-1.14", "--dry-run", "--json"], deps), 0);
      assert.equal(JSON.parse(out).kept, 1, "the live answer is not dropped as dead");
    } finally { if (before === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = before; }
  });
});

await testAsync("cmd-ledger: compaction refuses a manifest that leaves a document without a comparison", async () => {
  await inProject(async (cwd, cli) => {
    assert.equal((await cli(["docs", "--document-manifest", "manifest.json", "--yes"])).code, 1);
    const unbound = structuredClone(manifest); unbound.files.c = { path: "c.md", role: "document" };
    writeFileSync(join(cwd, "c.md"), "Another guide."); writeFileSync(join(cwd, "unbound.json"), JSON.stringify(unbound));
    const before = readdirSync(join(cwd, ".jev-lint", "judgments"));
    assert.equal((await cli(["ledger", "compact", "--document-manifest", "unbound.json"])).code, 3);
    assert.deepEqual(readdirSync(join(cwd, ".jev-lint", "judgments")), before);
  });
});

await testAsync("cmd-ledger: an explicit migrate is not pre-empted by the automatic one", async () => {
  await inProject(async (cwd, cli) => {
    mkdirSync(join(cwd, ".jev-lint"), { recursive: true });
    writeFileSync(join(cwd, ".jev-lint", "baseline.json"), JSON.stringify({ schema: "jev-lint-cache-4", entries: { aaaaaaaaaaaaaaaaaaaaaaaa: { value: 1, kind: "noul" } } }));
    const result = await cli(["ledger", "migrate", ".jev-lint/baseline.json", "--ledger", "archive"]);
    assert.equal(result.code, 0, result.log);
    assert.ok(Cache.load(join(cwd, "archive")).get("aaaaaaaaaaaaaaaaaaaaaaaa", "noul"));
    assert.ok(!existsSync(join(cwd, ".jev-lint", "verdicts")), "the default destination received nothing");
  });
});
