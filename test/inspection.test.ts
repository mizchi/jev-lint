import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test, testAsync } from "./harness.ts";
import { facts, evaluate, evolve, staticVerdict, type Sample, type Observation } from "../packages/pipeline/inspection.ts";
import { InspectionCache, observe } from "../packages/pipeline/inspection-cache.ts";
const sample = (id: string, description: string, expected: boolean): Sample => ({ id, name: id, description, expected });
const paid: Observation = { defect: false, usd: 0.01, ms: 25 };

test("inspection: static evidence overrides the model and ambiguous descriptions defer", () => {
  assert.equal(staticVerdict(facts(sample("a", "   ", true)), []), true);
  assert.equal(staticVerdict(facts(sample("my-tool", "My tool", true)), []), true);
  assert.equal(staticVerdict(facts(sample("a", "Parses a CSV stream", false)), []), undefined);
});

test("inspection: rewrite uses development labels and rejects a validation false positive", () => {
  const train = [sample("a", "Coming soon", true), sample("b", "Coming soon!", true)];
  const validation = [sample("c", "Coming soon.", true), sample("d", "Formats TOML", false)];
  const evidence = new Map(validation.map(item => [item.id, paid]));
  const rewritten = evolve(train, validation, evidence, [], 3);
  assert.equal(rewritten.rules.length, 1);
  const after = evaluate(validation, evidence, rewritten.rules);
  assert.equal(after.accuracy, 1);
  assert.equal(after.coldUsd, 0.01);
  assert.equal(after.serviceMs, 25);
  assert.equal(evolve(train, validation.map(item => ({ ...item, expected: false })), evidence, [], 3).rules.length, 0);
});

await testAsync("inspection: transient failure retries within budget; cached work replays with zero budget", async () => {
  const cache = new InspectionCache(":memory:");
  const item = sample("one", "ambiguous", false);
  let attempts = 0;
  const ask = async () => { if (++attempts === 1) throw new Error("transient"); return paid; };
  try {
    const control = { remaining: 2, attempts: 0, hits: 0, usd: 0 };
    assert.deepEqual(await observe(cache, "mock", item, ask, control, 1, () => true), paid);
    assert.deepEqual([control.remaining, control.attempts], [0, 2]);
    assert.deepEqual(await observe(cache, "mock", item, ask, control, 1, () => true), paid);
    assert.equal(control.hits, 1);
    assert.equal(await observe(cache, "other", item, ask, control, 0, () => false), undefined);
    assert.equal(attempts, 2);
  } finally { cache.close(); }
});

test("inspection: narrow a learned prefix when its broader version misclassifies validation", () => {
  const train = [sample("a", "Work in progress here", true), sample("b", "Work in progress until May", true)];
  const validation = [sample("c", "Work in progress for now", true), sample("d", "Work in parallel with multiple queues", false)];
  const evidence = new Map(validation.map(item => [item.id, paid]));
  const improved = evolve(train, validation, evidence, [], 2);
  assert.deepEqual(improved.rules, [{ prefix: "work in progress", defect: true }]);
});

test("inspection: stale writers cannot overwrite a newer policy", () => {
  const cache = new InspectionCache(":memory:");
  try {
    const first = [{ prefix: "coming soon", defect: true }];
    cache.rewrite("test", [], first);
    assert.throws(() => cache.rewrite("test", [], []), /concurrently/);
    assert.deepEqual(cache.rules("test"), first);
    assert.deepEqual(cache.rules("other"), []);
  } finally { cache.close(); }
});

await testAsync("inspection: exhausted transient attempts pause without poisoning the cache; auth fails immediately", async () => {
  const cache = new InspectionCache(":memory:");
  const unread = sample("a", "Retry me", true);
  const control = { remaining: 1, attempts: 0, hits: 0, usd: 0 };
  try {
    const fail = async () => { throw Error("transport"); };
    assert.equal(await observe(cache, "mock", unread, fail, control, 2, () => true), undefined);
    control.remaining = 4;
    await assert.rejects(observe(cache, "mock", unread, fail, control, 2, () => false), /transport/);
    assert.equal(control.remaining, 3);
    await assert.rejects(observe(cache, "mock", unread, async () => ({ ...paid, usd: NaN }), control, 2, () => true), /Invalid/);
    assert.deepEqual(await observe(cache, "mock", unread, async () => paid, control, 0, () => false), paid);
    assert.equal(control.attempts, 4);
  } finally { cache.close(); }
});

test("inspection: CLI resumes partial validation and reuses its learned program on the next invocation", () => {
  const dir = mkdtempSync(join(tmpdir(), "inspection-"));
  const cli = fileURLToPath(new URL("../packages/pipeline/inspect.ts", import.meta.url));
  const invoke = (...args: string[]) => JSON.parse(execFileSync(process.execPath,
    [cli, "--db", join(dir, "state.sqlite"), ...args], { encoding: "utf8" }));
  try {
    assert.equal(invoke("--evolve", "--budget", "1").complete, false);
    const learned = invoke("--evolve");
    assert.ok(learned.rewrites.length > 1);
    assert.ok(learned.execution.cacheHits > 0);
    assert.equal(learned.result.accuracy, 1);
    const replay = invoke("--budget", "0");
    assert.equal(replay.complete, true);
    assert.equal(replay.execution.attempts, 0);
    assert.deepEqual(replay.result.matches, learned.result.matches);
    const cold = invoke("--benchmark");
    assert.deepEqual(cold.arms.map((arm: { mode: string }) => arm.mode), ["model", "static", "active"]);
    assert.equal(cold.execution.cacheHits, 0);
    assert.ok(cold.arms[2].attempts < cold.arms[0].attempts);
    assert.equal(invoke("--evolve").rewrites.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
