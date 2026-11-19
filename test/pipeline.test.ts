import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testAsync } from "./harness.ts";
import { Decisions } from "../packages/pipeline/sqlite.ts";
import { run, type Item } from "../packages/pipeline/pipeline.ts";

const items = ["quiet", "quiet", "match", "quiet"].map((text, i) => ({ id: String(i), text }));
const decide = async (batch: readonly Item[]) => Number(batch.some(item => item.text === "match"));
const base = { items, decide, identity: "fixture", groupSize: 4, maxCalls: 20, pruneBelow: 0.1 };

await testAsync("pipeline: split, prune, stop at budget and resume across processes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-"));
  const path = join(dir, "decisions.sqlite");
  let store = new Decisions(path);
  try {
    const paused = await run({ ...base, store, maxCalls: 2 });
    assert.equal(paused.complete, false);
    assert.equal(paused.newCalls, 2);
    store.close();
    store = new Decisions(path);
    const done = await run({ ...base, store });
    assert.deepEqual(done.matches, ["2"]);
    assert.equal(done.decisions, 5);
    assert.equal(done.newCalls, 3);
    const replay = await run({ ...base, store, maxCalls: 0 });
    assert.equal(replay.complete, true);
    assert.deepEqual(replay.matches, done.matches);
    assert.equal((await run({ ...base, store, identity: "other", maxCalls: 0 })).complete, false);
    assert.equal((await run({ ...base, store, items: items.toReversed(), maxCalls: 0 })).complete, false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("pipeline: malformed scores and failed calls leave work retryable", async () => {
  const store = new Decisions(":memory:");
  try {
    for (const broken of [async () => NaN, async () => { throw Error("offline"); }]) {
      await assert.rejects(run({ ...base, store, decide: broken }));
    }
    assert.equal((await run({ ...base, store, maxCalls: 0 })).complete, false);
    const flat = await run({ ...base, store, groupSize: 1 });
    assert.equal(flat.decisions, 4);
    assert.deepEqual(flat.matches, ["2"]);
  } finally { store.close(); }
});

await testAsync("pipeline: split oversized groups before scoring and reject oversized individual inputs", async () => {
  const store = new Decisions(":memory:");
  try {
    const long = { id: "large", text: "あ".repeat(2000) };
    await assert.rejects(run({ ...base, store, items: [long], maxBytes: 80 }), /large/);
    const flat = await run({ ...base, store, maxBytes: 35 });
    assert.equal(flat.decisions, 4);
    assert.deepEqual(flat.matches, ["2"]);
    await assert.rejects(run({ ...base, store, items: [items[0], items[0]] }), /duplicate/i);
  } finally { store.close(); }
});

await testAsync("pipeline: sparse matches survive bounded traversal of 4096 records", async () => {
  const records = Array.from({ length: 4096 }, (_, i) => ({
    id: String(i), text: i === 37 || i === 3099 ? "match" : "quiet",
  }));
  const store = new Decisions(":memory:");
  try {
    const result = await run({ ...base, items: records, groupSize: 32, maxCalls: 150, store });
    assert.equal(result.complete, true);
    assert.deepEqual(result.matches, ["37", "3099"]);
    assert.equal(result.decisions, 148);
  } finally { store.close(); }
});
