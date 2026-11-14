import { strict as assert } from "node:assert";
import { parseRelationInput, readRelationJudgment } from "../src/relation-contract.ts";
import { relationInputOf } from "./relation-fixtures.ts";
import { test } from "./harness.ts";

test("relation-contract: authority is supplied with immutable approval metadata and exact multi-source evidence", () => {
  const input = relationInputOf();
  assert.deepEqual(parseRelationInput(input), input);
  for (const mutate of [
    (value: typeof input) => { value.sources[0].approval = null; },
    (value: typeof input) => { value.sources[0].ref = "main"; },
    (value: typeof input) => { value.sources[0].content = "Unapproved replacement."; },
    (value: typeof input) => { value.relations[0].targets[0].quote = "Invented evidence."; },
    (value: typeof input) => { value.sources[1].path = "../outside.ts"; },
    (value: typeof input) => { value.sources[1].ref = "d".repeat(40); },
  ]) { const value = structuredClone(input); mutate(value); assert.throws(() => parseRelationInput(value)); }
});

test("relation-contract: an externally expected but unextracted claim remains representable", () => {
  const input = relationInputOf(); input.expectedClaimIds.push("not-extracted");
  assert.equal(parseRelationInput(input).expectedClaimIds.length, 2);
  input.relations[0].claimId = "not-extracted";
  assert.throws(() => parseRelationInput(input));
});

test("relation-contract: invalid, missing and overconfident choice payloads are no verdict", () => {
  const answer = { type: "choice", choice: "contradicts", confidence: 0.9,
    probabilities: { supports: 0.02, contradicts: 0.95, unrelated: 0.01, insufficient_context: 0.02 } };
  assert.equal(readRelationJudgment(answer)?.choice, "contradicts");
  for (const value of [null, {}, { ...answer, choice: "merge" }, { ...answer, confidence: 2 },
    { ...answer, probabilities: { ...answer.probabilities, contradicts: Number.NaN } },
    { ...answer, probabilities: { ...answer.probabilities, supports: 0.8 } },
    { ...answer, choice: "supports" }]) assert.equal(readRelationJudgment(value), null);
});
