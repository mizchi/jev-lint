import { strict as assert } from "node:assert";
import { compareModels, planModelRequests } from "../src/model-eval.ts";
import { estimateTokens } from "../src/batch.ts";
import type { Batch } from "../src/types.ts";
import { ruleTextHash } from "../src/rules.ts";
import type { EvalAnswer, EvalRecord } from "../src/evals.ts";
import { noulRule } from "./builders.ts";
import { test } from "./harness.ts";

const rule = noulRule({ id: "r", threshold: 0.7 });
const rules = [rule];
const labels = { $default: "clean" as const, "fixtures/a.ts": [{ line: 1, label: "bad" as const, rule: "r", window: 0 }] };
const answer = (line: number, value: number | null): EvalAnswer => ({ rule: "r", file: "fixtures/a.ts", line, value, confidence: null });
const record = (passes: EvalAnswer[][]): EvalRecord => ({
  schema: "jev-lint-eval-1", suite: "typescript/r", recorded: "2026-10-02", model: "test-model",
  rules: [{ id: rule.id, draft: ruleTextHash(rule), at: 0.7 }], cutoffs: {}, passes,
  spent: { calls: passes.length, inputTokens: 100, usd: 0.001, ms: 10 },
});


test("model-eval: shipped cutoffs and a same-corpus refit answer different questions", () => {
  const baseline = record([[answer(1, 0.9), answer(2, 0.1)], [answer(1, 0.9), answer(2, 0.1)]]);
  const clef = record([[answer(1, 0.6), answer(2, 0.1)], [answer(1, 0.6), answer(2, 0.1)]]);
  const comparison = compareModels(baseline, clef, labels, rules);
  assert.equal(comparison.complete, true);
  assert.equal(comparison.baseline.shipped.tp, 1);
  assert.equal(comparison.candidate.shipped.fn, 1);
  assert.equal(comparison.candidate.refitted.tp, 1);
  assert.equal(comparison.regressions.length, 1);
  assert.equal(comparison.candidate.thresholds.r.shipped, 0.7);
  assert.ok(comparison.candidate.thresholds.r.fitted! < 0.6);
});


test("model-eval: missing answers and absent cases cannot look like a complete improvement", () => {
  const baseline = record([[answer(1, 0.9), answer(2, 0.1)], [answer(1, 0.9), answer(2, 0.1)]]);
  const candidate = record([[answer(1, null)], [answer(1, 0.8)]]);
  const comparison = compareModels(baseline, candidate, labels, rules);
  assert.equal(comparison.complete, false);
  assert.equal(comparison.candidate.missingAnswers, 3);
  assert.equal(comparison.pairedSubjects, 0);
  assert.equal(comparison.candidate.shipped.recall, null);
  assert.equal(comparison.regressions.length, 0);
});


test("model-eval: changed rule drafts, missing rule records and different suites are refused", () => {
  const baseline = record([[answer(1, 0.9)]]);
  for (const candidate of [
    { ...baseline, rules: [{ ...baseline.rules[0], draft: "old" }] },
    { ...baseline, rules: [] },
    { ...baseline, suite: "another/r" },
  ]) assert.throws(() => compareModels(baseline, candidate, labels, rules), /incompatible/);
});


test("model-eval: decisions that flip across passes are measured at the shipped cutoff", () => {
  const baseline = record([[answer(1, 0.8), answer(2, 0.1)], [answer(1, 0.8), answer(2, 0.1)]]);
  const candidate = record([[answer(1, 0.6), answer(2, 0.1)], [answer(1, 0.9), answer(2, 0.1)]]);
  const comparison = compareModels(baseline, candidate, labels, rules);
  assert.equal(comparison.candidate.shipped.flips, 1);
  assert.equal(comparison.candidate.shipped.tp, 1);
  assert.equal(comparison.baseline.shipped.flips, 0);
});


test("model-eval: differing multiplicities, out-of-range and nonfinite answers are incomplete", () => {
  const baseline = record([[answer(1, 0.9), answer(2, 0.1)]]);
  for (const pass of [[answer(1, 0.8), answer(1, 0.8), answer(2, 0.1)],
    [answer(1, Number.NaN), answer(2, 0.1)], [answer(1, 1.1), answer(2, 0.1)]]) {
    assert.equal(compareModels(baseline, record([pass]), labels, rules).complete, false);
  }
});


test("model-eval: multiple selected nodes on one labelled line are compared as one location", () => {
  const baseline = record([[answer(1, 0.9), answer(2, 0.1), answer(2, 0.2)]]);
  const candidate = record([[answer(1, 0.9), answer(2, 0.2), answer(2, 0.1)]]);
  const comparison = compareModels(baseline, candidate, labels, rules);
  assert.equal(comparison.complete, true);
  assert.equal(comparison.pairedSubjects, 2);
  assert.equal(comparison.candidate.missingAnswers, 0);
  assert.equal(comparison.candidate.shipped.tn, 1);
});


test("model-eval: the plan bills the state for every group of 64 questions", () => {
  const state = { code: "a".repeat(2000) };
  const questions = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`q${i}`, { type: "noul", instructions: { ask: "test" } }]));
  const batches = [{ state, questions }] as unknown as Batch[];
  const clef = planModelRequests(batches, 3, 64);
  const jev = planModelRequests(batches, 3, Infinity);
  assert.equal(clef.requests, 6);
  assert.equal(jev.requests, 3);
  assert.ok(clef.tokens >= jev.tokens + 3 * estimateTokens(state));
  assert.throws(() => planModelRequests(batches, 3, 0), /positive/);
});
