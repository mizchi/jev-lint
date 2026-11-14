import { strict as assert } from "node:assert";
import { evaluateRelations, replayRelationEvaluation } from "../src/relation-eval.ts";
import type { RelationReport } from "../src/relation-contract.ts";
import { readFileSync } from "node:fs";
import type { RelationCase, RelationExpectation } from "../src/relation-eval.ts";
import { relationInputOf } from "./relation-fixtures.ts";
import { testAsync } from "./harness.ts";

await testAsync("relation-eval: failed and unexecuted judgments remain in every rubric denominator", async () => {
  const input = relationInputOf();
  const report = await evaluateRelations({ cases: [{ id: "sample", input }],
    expected: [{ id: "sample", choices: ["contradicts"], resolution: "implementation", statuses: ["complete"] }], repeat: 3,
    run: async () => { throw new Error("provider unavailable"); } });
  assert.equal(report.samples.length, 3);
  assert.equal(report.total, 0);
  assert.equal(report.missing, 3);
  assert.equal(report.gate, "fail");
  assert.equal(report.precision, null);
  assert.equal(report.recall, 0);
});

await testAsync("relation-eval: missing, duplicate or extra oracle entries cannot shrink the dataset", async () => {
  const cases = [{ id: "sample", input: relationInputOf() }];
  const item = { id: "sample", choices: ["contradicts" as const], resolution: "implementation" as const, statuses: ["complete" as const] };
  for (const expected of [[], [item, item], [{ ...item, id: "other" }]]) {
    await assert.rejects(evaluateRelations({ cases, expected, repeat: 1, run: async () => { throw new Error(); } }));
  }
});

await testAsync("relation-eval: malformed partial reports cannot keep credit computed before failure", async () => {
  const report = await evaluateRelations({ cases: [{ id: "sample", input: relationInputOf() }],
    expected: [{ id: "sample", choices: ["contradicts"], resolution: "implementation", statuses: ["complete"] }], repeat: 1,
    run: async () => ({ candidates: [{ judgment: { choice: "contradicts" }, resolution: "implementation" }] } as unknown as RelationReport) });
  assert.equal(report.total, 0); assert.equal(report.missing, 1);
});

await testAsync("relation-eval: replay recalculates edited scores and retains missing samples", async () => {
  const cases = [{ id: "sample", input: relationInputOf() }];
  const expected = [{ id: "sample", choices: ["contradicts" as const], resolution: "implementation" as const, statuses: ["complete" as const] }];
  const original = await evaluateRelations({ cases, expected, repeat: 2, run: async () => { throw new Error(); } });
  original.total = 100; original.gate = "pass"; original.samples = [];
  const replay = await replayRelationEvaluation(cases, expected, original);
  assert.equal(replay.total, 0); assert.equal(replay.missing, 2); assert.equal(replay.gate, "fail");
});

await testAsync("relation-eval: the shipped corpus has aligned labels and valid pinned source citations", async () => {
  const cases = JSON.parse(readFileSync("experiments/relations/inputs.json", "utf8")).cases as RelationCase[];
  const expected = JSON.parse(readFileSync("experiments/relations/expect.json", "utf8")).cases as RelationExpectation[];
  const result = await evaluateRelations({ cases, expected, repeat: 1, run: async () => { throw new Error("offline"); } });
  assert.equal(result.samples.length, cases.length);
  assert.equal(result.missing, cases.length);
  assert.equal(result.total, 0);
});

await testAsync("relation-eval: removing a required grounding answer makes a modern recorded run fail", async () => {
  const cases = JSON.parse(readFileSync("experiments/relations/inputs.json", "utf8")).cases as RelationCase[];
  const expected = JSON.parse(readFileSync("experiments/relations/expect.json", "utf8")).cases as RelationExpectation[];
  const raw = JSON.parse(readFileSync("experiments/relations/v3-iteration-01.json", "utf8"));
  delete raw.samples[0].report.candidates[0].claimJudgment;
  const replay = await replayRelationEvaluation(cases, expected, raw);
  assert.equal(replay.gate, "fail");
  assert.equal(replay.missing, 1);
  assert.equal(replay.samples[0].checks.semantic, false);
});

await testAsync("relation-eval: expanded boundary and state-transition cases have valid independent labels", async () => {
  const cases = JSON.parse(readFileSync("experiments/relations/extended/inputs.json", "utf8")).cases as RelationCase[];
  const expected = JSON.parse(readFileSync("experiments/relations/extended/expect.json", "utf8")).cases as RelationExpectation[];
  const result = await evaluateRelations({ cases, expected, repeat: 1, run: async () => { throw new Error("offline"); } });
  assert.equal(result.samples.length, cases.length);
  assert.equal(result.missing, cases.length);
  assert.equal(result.gate, "fail");
});
