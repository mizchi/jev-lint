import assert from "node:assert/strict";
import { test } from "./harness.ts";
import { nextDecision } from "../packages/pipeline/decision-table.ts";
import { catalogRoute, manifestRoute } from "../packages/pipeline/routes.ts";
import { facts, staticVerdict } from "../packages/pipeline/inspection.ts";

test("decision table: two sources agree, disagree, abstain or pause for a missing answer", () => {
  assert.deepEqual(nextDecision(catalogRoute, {}), { need: "catalog" });
  assert.deepEqual(nextDecision(catalogRoute, { catalog: "hardware" }), { need: "text" });
  assert.deepEqual(nextDecision(catalogRoute, { catalog: "software", text: "software" }), { done: "software" });
  assert.deepEqual(nextDecision(catalogRoute, { catalog: "software", text: "hardware" }), { done: "review" });
  assert.deepEqual(nextDecision(catalogRoute, { catalog: "abstain" }), { done: "review" });
  assert.deepEqual(nextDecision(catalogRoute, { text: "abstain" }), { done: "review" });
  assert.throws(() => nextDecision(catalogRoute, { catalog: "unknown" }), /catalog/);
  assert.throws(() => nextDecision(catalogRoute, { category: "software" }), /category/);
});

test("decision table: first possible row keeps priority until its missing fact is known", () => {
  const plan = { ...catalogRoute, rows: [
    { when: [["catalog", "software"], ["text", "hardware"]], then: "review" },
    { when: [["catalog", "software"]], then: "software" },
  ] } as const;
  assert.deepEqual(nextDecision(plan, { catalog: "software" }), { need: "text" });
  assert.deepEqual(nextDecision(plan, { catalog: "software", text: "software" }), { done: "software" });
});

test("decision table: existing manifest verdicts short-circuit the model and survive JSON replay", () => {
  const plan = JSON.parse(JSON.stringify(manifestRoute));
  for (const [description, observed] of [["", "defect"], ["Example parser", "clean"], ["Converts CSV files", "defer"]]) {
    const verdict = staticVerdict(facts({ id: "x", name: "x", description }), [{ prefix: "example parser", defect: false }]);
    const check = verdict === undefined ? "defer" : verdict ? "defect" : "clean";
    assert.equal(check, observed);
    const answer = nextDecision(plan, { check });
    if (check === "defer") {
      assert.deepEqual(answer, { need: "model" });
      assert.deepEqual(nextDecision(plan, { check, model: "clean" }), { done: "clean" });
    } else assert.deepEqual(answer, { done: check });
  }
});
