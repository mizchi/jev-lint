import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cwd = fileURLToPath(new URL("../", import.meta.url));

test("a fresh process resumes the original table and preserves a pending fact after invalid input", t => {
  const dir = mkdtempSync(join(tmpdir(), "langgraph-catalog-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = join(dir, "checkpoint.sqlite");
  function invoke(...args) {
    return JSON.parse(execFileSync(process.execPath, ["catalog.mjs", "--db", db, ...args],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  }
  const started = invoke("start", "hardware");
  assert.equal(started.need, "text");
  assert.throws(() => invoke("resume", started.thread, "unknown"), /Unknown observation/);
  assert.deepEqual(invoke("resume", started.thread, "software"), { thread: started.thread, done: "review" });
  assert.throws(() => invoke("resume", started.thread, "hardware"), /No pending/);
  assert.throws(() => invoke("resume", "missing", "hardware"), /No pending/);
  const agreement = invoke("start", "software");
  assert.equal(invoke("resume", agreement.thread, "software").done, "software");
  assert.equal(invoke("start", "abstain").done, "review");

  // Simulate a run started by an older release with a different disagreement outcome.
  const previous = `
    import { createCatalogGraph } from "./graph.mjs";
    import { catalogRoute } from "../../packages/pipeline/routes.ts";
    const graph = createCatalogGraph(process.argv[1]);
    await graph.invoke({ policy: { ...catalogRoute, otherwise: "older-review-queue" },
      observations: { catalog: "hardware" } }, { configurable: { thread_id: "previous" } });
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", previous, db], { cwd });
  assert.equal(invoke("resume", "previous", "software").done, "older-review-queue");
});
