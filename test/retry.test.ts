import { strict as assert } from "node:assert";
import { gate } from "../src/gate.ts";
import { mergePasses } from "../src/run.ts";
import { scoreRule, noulRule, subjectOf, answer } from "./builders.ts";
import { test } from "./harness.ts";

test("retry: the mean decides, and the pass count is kept beside it", () => {
  const rule = noulRule({ id: "n", at: 0.6 });
  const s = subjectOf({ rule, file: "a.ts", line: 1 });
  const pass = (v: number) => [{ subject: s, answer: { value: v, confidence: null, kind: "noul" as const }, cached: false }];
  // 0.7 / 0.5 / 0.7 -> mean 0.633, over its 0.6 cutoff in 2 of 3 passes.
  const merged = mergePasses([pass(0.7), pass(0.5), pass(0.7)], {});
  assert.equal(merged.length, 1);
  assert.ok(Math.abs(merged[0]!.answer!.value - 0.6333) < 0.001, "the mean, not the last pass");
  assert.deepEqual(merged[0]!.stability, { over: 2, of: 3, spread: 0.2 });
});

test("retry: a failed pass is not counted as a disagreement", () => {
  // A missing answer is a failed request, which `missing` already reports.
  // Counting it as a pass that disagreed would make a flaky network look like
  // an unstable rule.
  const rule = noulRule({ id: "n", at: 0.5 });
  const s = subjectOf({ rule, file: "a.ts", line: 1 });
  const okPass = [{ subject: s, answer: { value: 0.9, confidence: null, kind: "noul" as const }, cached: false }];
  const failedPass = [{ subject: s, answer: null, cached: false }];
  const merged = mergePasses([okPass, failedPass, okPass], {});
  assert.deepEqual(merged[0]!.stability, { over: 2, of: 2, spread: 0 });
  assert.equal(merged[0]!.answer!.value, 0.9);
});

test("retry: a subject no pass answered stays missing rather than becoming zero", () => {
  const s = subjectOf({ rule: noulRule({ id: "n" }), file: "a.ts", line: 1 });
  const merged = mergePasses([[{ subject: s, answer: null, cached: false }]], {});
  assert.equal(merged[0]!.answer, null);
  assert.equal(merged[0]!.stability, undefined);
  // And the gate turns that into a counted `missing`, not a clean bill.
  assert.equal(gate(merged).stats.missing, 1);
});

test("retry: an override cutoff is what the pass count is measured against", () => {
  const rule = noulRule({ id: "n", at: 0.9 });
  const s = subjectOf({ rule, file: "a.ts", line: 1 });
  const pass = (v: number) => [{ subject: s, answer: { value: v, confidence: null, kind: "noul" as const }, cached: false }];
  const atRule = mergePasses([pass(0.7), pass(0.8)], {});
  assert.equal(atRule[0]!.stability!.over, 0, "neither pass reaches the rule's 0.9");
  const atOverride = mergePasses([pass(0.7), pass(0.8)], { n: 0.6 });
  assert.equal(atOverride[0]!.stability!.over, 2, "both reach an overridden 0.6");
});

test("retry: confidences are averaged over the passes that had one", () => {
  const rule = scoreRule({ id: "s", at: 2 });
  const s = subjectOf({ rule, file: "a.ts", line: 1 });
  const pass = (v: number, c: number | null) => [
    { subject: s, answer: { value: v, confidence: c, kind: "score" as const }, cached: false },
  ];
  const merged = mergePasses([pass(2.5, 0.8), pass(2.5, 0.6), pass(2.5, null)], {});
  assert.ok(Math.abs(merged[0]!.answer!.confidence! - 0.7) < 0.001);
  const none = mergePasses([pass(2.5, null), pass(2.5, null)], {});
  assert.equal(none[0]!.answer!.confidence, null);
});
