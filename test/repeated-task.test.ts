import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test, testAsync } from "./harness.ts";
import { collectHistory, contract, compileCover, covers, search, solveGroup, type Group } from "../packages/pipeline/repeated-task.ts";

const trap: Group = { required: ["a","b","c","d","e","f"], limit: 2, suites: [
  { id: "trap", covers: ["a","b","c","d"] }, { id: "left", covers: ["a","b","e"] }, { id: "right", covers: ["c","d","f"] },
] };
test("repeated-task: verify a witness, reject unknown or duplicated suites and uncovered obligations", () => {
  assert.ok(covers(trap, ["left","right"]));
  for (const bad of [["trap","left"], ["left","left"], ["left","right","trap"], ["left","unknown"], null]) assert.ok(!covers(trap, bad));
});

await testAsync("repeated-task: escalate only on a local miss and validate either route", async () => {
  let calls = 0;
  const teacher = async () => { calls++; return ["left","right"]; };
  assert.equal((await solveGroup(trap, { order: "gain", budget: 30 }, teacher)).route, "local");
  assert.equal(calls, 0);
  assert.equal((await solveGroup(trap, { order: "gain", budget: 2 }, teacher)).route, "teacher");
  assert.equal(calls, 1);
  assert.equal((await solveGroup(trap, { order: "gain", budget: 2 }, async () => ["trap"])).route, "unresolved");
  assert.equal((await solveGroup(trap, { order: "gain", budget: 2 }, async () => { throw Error("offline"); })).route, "unresolved");
});

test("repeated-task: duplicate traces cannot qualify a family for compilation", () => {
  assert.throws(() => compileCover([trap, trap], 2), /distinct/);
});

test("repeated-task: exhaustive local search agrees with independent enumeration on all 3x3 Boolean coverage matrices", () => {
  for (let mask = 0; mask < 512; mask++) {
    const required = ["a","b","c"];
    const suites = required.map((id, i) => ({ id, covers: required.filter((_, j) => mask & (1 << (3*i+j))) }));
    for (let limit = 0; limit <= 3; limit++) {
      const group = { required, suites, limit };
      const feasible = Array.from({length: 8}, (_, bits) => suites.filter((_, i) => bits & (1 << i)))
        .some(set => set.length <= limit && required.every(tag => set.some(suite => suite.covers.includes(tag))));
      for (const order of ["listed", "gain"] as const) {
        const solution = search(group, { order, budget: 100 }).answer;
        assert.equal(solution !== null, feasible);
        if (solution) assert.ok(covers(group, solution));
      }
    }
  }
});

await testAsync("repeated-task: cold start delegates and proven infeasibility needs no model", async () => {
  assert.equal((await solveGroup(trap, null, async () => ["left","right"])).route, "teacher");
  const impossible = { ...trap, required: ["absent"] };
  let calls = 0;
  const result = await solveGroup(impossible, { order: "gain", budget: 2 }, async () => { calls++; return []; });
  assert.equal(result.route, "infeasible");
  assert.equal(calls, 0);
});

test("repeated-task: recurrence counts real invocations but excludes unrelated and unverified examples from fitting", () => {
  const event = { contract, model: "teacher", group: trap, selected: ["left","right"] };
  const history = collectHistory([event, { ...event, group: { ...trap, suites: trap.suites.toReversed() } },
    { ...event, group: { ...trap, limit: 1 } }, { ...event, contract: "other" }, { ...event, model: "other" }], "teacher");
  assert.equal(history.calls, 3);
  assert.equal(history.seen.size, 2);
  assert.equal(history.verified.length, 1);
});

test("repeated-task: a hybrid success cannot pass a local-only held-out gate", () => {
  const cli = fileURLToPath(new URL("../packages/pipeline/eval-repeated.ts", import.meta.url));
  const invoke = (budget: string, gate: string) => spawnSync(process.execPath,
    [cli, "--budget", budget, "--require", gate], { encoding: "utf8", env: {} });
  const hybrid = invoke("2", "verified");
  assert.equal(hybrid.status, 0, hybrid.stderr);
  assert.equal(JSON.parse(hybrid.stdout).summary.teacher, 1);
  assert.equal(invoke("2", "local").status, 1);
  assert.equal(invoke("8", "local").status, 0);
});

await testAsync("repeated-task: a single repeated verified instance reuses its witness without claiming generalization", async () => {
  const history = collectHistory([{ contract, model: "teacher", group: trap, selected: ["left", "right"] }], "teacher");
  let calls = 0;
  const reordered = { ...trap, suites: trap.suites.toReversed() };
  const result = await solveGroup(reordered, null, async () => { calls++; return []; }, history.witnesses);
  assert.equal(result.route, "history");
  assert.equal(calls, 0);
});
