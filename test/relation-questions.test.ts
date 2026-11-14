import { strict as assert } from "node:assert";
import { prepareQuestion, RELATION_QUESTION } from "../src/relation-questions.ts";
import { test } from "./harness.ts";

test("relation-questions: operator questions are cloned and unusable choice contracts are rejected", () => {
  const operator = structuredClone(RELATION_QUESTION), accepted = prepareQuestion(operator);
  operator.criteria.supports = "changed later";
  assert.notEqual(accepted.criteria.supports, operator.criteria.supports);
  for (const invalid of [null, { ...operator, type: "score" }, { ...operator, criteria: { supports: "Yes" } },
    { ...operator, criteria: { ...operator.criteria, contradicts: "" } }, { ...operator, instructions: [] }]) {
    assert.throws(() => prepareQuestion(invalid as typeof operator), /invalid relation question/);
  }
});
