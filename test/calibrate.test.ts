import { strict as assert } from "node:assert";
import { relative } from "node:path";
import { widestGap, gapReport, fitCutoffs, labelFor, stabilityReport } from "../src/calibrate.ts";
import { labelsOf, scoreRule, noulRule } from "./builders.ts";
import { test } from "./harness.ts";

test("calibrate: widestGap finds the largest step and where it sits", () => {
  const g = widestGap([0.1, 0.15, 0.9, 0.95]);
  assert.ok(Math.abs(g.gap - 0.75) < 1e-9);
  assert.ok(Math.abs(g.low! - 0.15) < 1e-9);
  assert.ok(Math.abs(g.high! - 0.9) < 1e-9);
  assert.equal(widestGap([]).gap, 0);
  assert.equal(widestGap([0.5]).gap, 0);
});

test("calibrate: a wide gap with the cutoff inside it reads `works`", () => {
  const rule = noulRule({ at: 0.5 });
  const all = [0.05, 0.1, 0.12, 0.14, 0.9, 0.93, 0.95].map((value: number, i: number) => ({
    rule: "n",
    file: "a.rs",
    line: i,
    value,
  }));
  const row = gapReport(all, [rule])[0]!;
  assert.equal(row.verdict, "works");
  assert.equal(row.inGap, true);
  assert.equal(row.reported, 3);
});

test("calibrate: a wide gap with the cutoff outside it reads `move` and suggests the midpoint", () => {
  const rule = noulRule({ at: 0.95 });
  const all = [0.05, 0.1, 0.12, 0.14, 0.8, 0.82, 0.84].map((value: number, i: number) => ({
    rule: "n",
    file: "a.rs",
    line: i,
    value,
  }));
  const row = gapReport(all, [rule])[0]!;
  assert.equal(row.verdict, "move");
  assert.ok(Math.abs(row.suggested - 0.46) < 0.02);
});

test("calibrate: bunched answers read `rewrite`, because no cutoff can fix them", () => {
  const rule = noulRule({ at: 0.5 });
  const all = [0.41, 0.43, 0.45, 0.48, 0.52, 0.55, 0.57].map((value: number, i: number) => ({
    rule: "n",
    file: "a.rs",
    line: i,
    value,
  }));
  assert.equal(gapReport(all, [rule])[0]!.verdict, "rewrite");
});

test("calibrate: too few answers read `thin`, which is not a verdict on the rule", () => {
  // The threshold matters: a widest-gap statistic over a handful of answers is
  // noise, and "rewrite the sentence" is expensive advice to give on noise.
  // This boundary was raised after the report called a real rule `rewrite` on
  // three subjects.
  const rule = noulRule({ at: 0.5 });
  const five = [0.9, 0.91, 0.92, 0.93, 0.94].map((value: number, i: number) => ({
    rule: "n",
    file: "a.rs",
    line: i,
    value,
  }));
  assert.equal(gapReport(five, [rule])[0]!.verdict, "thin");
  const six = [...five, { rule: "n", file: "a.rs", line: 9, value: 0.95 }];
  assert.notEqual(gapReport(six, [rule])[0]!.verdict, "thin", "six is enough to judge");
});

test("calibrate: a matcher that never fired reads `silent`, not clean", () => {
  const row = gapReport([], [noulRule()])[0]!;
  assert.equal(row.verdict, "silent");
  assert.equal(row.matches, 0);
});

test("calibrate: `wide` is judged relative to the scale, not absolutely", () => {
  // 0.4 is narrow on a 0-3 score and wide on a 0-1 noul.
  const values = [0.1, 0.11, 0.12, 0.15, 0.55, 0.57, 0.58];
  const asNoul = gapReport(
    values.map((value: number, i: number) => ({ rule: "n", file: "a", line: i, value })),
    [noulRule({ at: 0.3 })],
  )[0];
  const asScore = gapReport(
    values.map((value: number, i: number) => ({ rule: "r", file: "a", line: i, value })),
    [scoreRule({ at: 0.3 })],
  )[0];
  assert.equal(asNoul!.verdict, "works");
  assert.equal(asScore!.verdict, "rewrite");
});

test("calibrate: a separable corpus fits the midpoint of the gap, not its edge", () => {
  // A cutoff at "highest clean plus a hair" sits on the false-positive boundary
  // and the next sample crosses it.
  const rule = noulRule({ id: "n" });
  const all = [
    { rule: "n", file: "a.rs", line: 1, value: 0.1 },
    { rule: "n", file: "a.rs", line: 2, value: 0.2 },
    { rule: "n", file: "a.rs", line: 3, value: 0.9 },
  ];
  const labels = labelsOf({
    $default: "clean",
    "a.rs": [{ line: 3, label: "bad", rule: "n", window: 0 }],
  });
  const fit = fitCutoffs(all, labels, [rule])[0]!;
  assert.equal(fit.separable, true);
  assert.ok(Math.abs(fit.fitted! - 0.55) < 0.01, `expected the midpoint, got ${fit.fitted}`);
  assert.equal(fit.precision, 1);
  assert.equal(fit.recall, 1);
});

test("calibrate: an overlapping corpus reports no separating cutoff rather than pretending", () => {
  const rule = noulRule({ id: "n" });
  const all = [
    { rule: "n", file: "a.rs", line: 1, value: 0.8 },
    { rule: "n", file: "a.rs", line: 2, value: 0.3 },
  ];
  const labels = labelsOf({
    $default: "clean",
    "a.rs": [{ line: 2, label: "bad", rule: "n", window: 0 }],
  });
  const fit = fitCutoffs(all, labels, [rule])[0]!;
  assert.equal(fit.separable, false);
  assert.match(fit.reason, /no separating cutoff/);
});

test("calibrate: means that separate but ranges that overlap are not `separable` -- a distinct reason from a genuine overlap", () => {
  // The bug this fitter replaces: means 0.2 and 0.3 don't overlap, so the old
  // point-fit called this `separable: true` and put the cutoff at their
  // midpoint (0.25) -- exactly where the clean case's own 0.25 pass and the
  // defect's own 0.25 pass land, a coin flip on the very corpus that was
  // supposed to justify the cutoff.
  const rule = noulRule({ id: "n" });
  const all = [
    { rule: "n", file: "a.rs", line: 1, value: 0.2, min: 0.15, max: 0.25 },
    { rule: "n", file: "a.rs", line: 2, value: 0.3, min: 0.25, max: 0.35 },
  ];
  const labels = labelsOf({
    $default: "clean",
    "a.rs": [{ line: 2, label: "bad", rule: "n", window: 0 }],
  });
  const fit = fitCutoffs(all, labels, [rule])[0]!;
  assert.equal(fit.separable, false, "the ranges touch at 0.25, so this is not separable even though the means are");
  assert.match(fit.reason, /means separate but the observed ranges overlap/);
  assert.doesNotMatch(fit.reason, /no separating cutoff; best trade-off/, "a distinct reason from a genuine (mean) overlap");
});

test("calibrate: a genuine overlap -- means overlap too -- keeps its own reason, not the ranges-overlap one", () => {
  const rule = noulRule({ id: "n" });
  const all = [
    { rule: "n", file: "a.rs", line: 1, value: 0.8, min: 0.6, max: 0.9 },
    { rule: "n", file: "a.rs", line: 2, value: 0.3, min: 0.1, max: 0.7 },
  ];
  const labels = labelsOf({
    $default: "clean",
    "a.rs": [{ line: 2, label: "bad", rule: "n", window: 0 }],
  });
  const fit = fitCutoffs(all, labels, [rule])[0]!;
  assert.equal(fit.separable, false);
  assert.match(fit.reason, /^no separating cutoff; best trade-off$/);
});

test("calibrate: a case with no min/max is a zero-width interval -- identical to a single-pass fit", () => {
  const rule = noulRule({ id: "n" });
  const labels = labelsOf({
    $default: "clean",
    "a.rs": [{ line: 3, label: "bad", rule: "n", window: 0 }],
  });
  const pointOnly = [
    { rule: "n", file: "a.rs", line: 1, value: 0.1 },
    { rule: "n", file: "a.rs", line: 2, value: 0.2 },
    { rule: "n", file: "a.rs", line: 3, value: 0.9 },
  ];
  // The same cases, with an explicit zero-width range at each value -- what
  // a caller that measured exactly one pass would report.
  const explicitZeroWidth = pointOnly.map((a) => ({ ...a, min: a.value, max: a.value }));
  const withoutRange = fitCutoffs(pointOnly, labels, [rule])[0]!;
  const withZeroWidthRange = fitCutoffs(explicitZeroWidth, labels, [rule])[0]!;
  assert.deepEqual(withoutRange, withZeroWidthRange);
  assert.equal(withoutRange.separable, true);
  assert.ok(Math.abs(withoutRange.fitted! - 0.55) < 0.01);
});

test("calibrate: interval fitting normalises through `scaleOf` for a score rule's 0-3 rubric, not a 0-1 assumption", () => {
  const rule = scoreRule({ id: "s", kind: "score" });
  const all = [
    { rule: "s", file: "a.ts", line: 1, value: 1.0, min: 0.8, max: 1.2 },
    { rule: "s", file: "a.ts", line: 2, value: 2.0, min: 1.8, max: 2.2 },
  ];
  const labels = labelsOf({
    $default: "clean",
    "a.ts": [{ line: 2, label: "bad", rule: "s", window: 0 }],
  });
  const fit = fitCutoffs(all, labels, [rule])[0]!;
  // The ranges (0.8-1.2 clean, 1.8-2.2 bad) don't overlap on the raw 0-3
  // scale, so this is separable at their midpoint (1.5) -- not at some
  // fraction of 3, which is what a stray /scale in the interval comparison
  // would have produced.
  assert.equal(fit.separable, true);
  assert.ok(Math.abs(fit.fitted! - 1.5) < 0.01, `expected 1.5 on the raw scale, got ${fit.fitted}`);

  // Shrink the gap to overlap on the same 0-3 scale: means still separate
  // (1.0 vs 2.0) but the ranges now touch at 1.5.
  const overlapping = [
    { rule: "s", file: "a.ts", line: 1, value: 1.0, min: 0.5, max: 1.5 },
    { rule: "s", file: "a.ts", line: 2, value: 2.0, min: 1.5, max: 2.5 },
  ];
  const overlapFit = fitCutoffs(overlapping, labels, [rule])[0]!;
  assert.equal(overlapFit.separable, false);
  assert.match(overlapFit.reason, /means separate but the observed ranges overlap/);
});

test("calibrate: a fit over one pass is not the fit over the mean of two", () => {
  // Why `replay --labels` averages a record's passes instead of scoring its
  // top-level `answers` (the last pass alone): a per-pass fit and a
  // mean-of-passes fit are different numbers, so replaying one pass would print
  // a cutoff that disagrees with the one calibrate derived and shipped.
  const rule = noulRule({ id: "n" });
  const labels = labelsOf({
    $default: "clean",
    "a.rs": [{ line: 2, label: "bad", rule: "n", window: 0 }],
  });
  const pass = (clean: number, bad: number) => [
    { rule: "n", file: "a.rs", line: 1, value: clean },
    { rule: "n", file: "a.rs", line: 2, value: bad },
  ];
  const fitOverLastPass = fitCutoffs(pass(0.1, 0.9), labels, [rule])[0]!;
  const fitOverBothPasses = fitCutoffs(
    // The mean this stands in for is what cli.ts's mergeRuns computes.
    [
      { rule: "n", file: "a.rs", line: 1, value: (0.1 + 0.5) / 2 },
      { rule: "n", file: "a.rs", line: 2, value: (0.9 + 0.7) / 2 },
    ],
    labels,
    [rule],
  )[0]!;
  assert.equal(fitOverLastPass.separable, true);
  assert.equal(fitOverBothPasses.separable, true);
  assert.notEqual(fitOverLastPass.fitted, fitOverBothPasses.fitted);
});

test("calibrate: a rule with no labeled violations reports why, not a number", () => {
  const fit = fitCutoffs(
    [{ rule: "n", file: "a.rs", line: 1, value: 0.2 }],
    labelsOf({ $default: "clean" }),
    [noulRule({ id: "n" })],
  )[0]!;
  assert.equal(fit.fitted, null);
  assert.match(fit.reason, /no labeled violations/);
});

test("calibrate: labels match within a window, respect the rule, and default", () => {
  const labels = labelsOf({
    $default: "clean",
    "a.ts": [
      { line: 10, label: "bad", rule: "r1", window: 2 },
      { line: 40, label: "clean", window: 2 },
    ],
  });
  assert.equal(labelFor(labels, "a.ts", 11, "r1"), "bad");
  assert.equal(labelFor(labels, "a.ts", 13, "r1"), "clean", "outside the window");
  assert.equal(labelFor(labels, "a.ts", 10, "r2"), "clean", "another rule's label");
  assert.equal(labelFor(labels, "b.ts", 1, "r1"), "clean", "unlisted file takes the default");
  assert.equal(labelFor(labelsOf({}), "b.ts", 1, "r1"), "unlabeled", "no default means unlabeled");
});

test("calibrate: stability reports a flip only when the decision changes", () => {
  const rule = noulRule({ id: "n", at: 0.5 });
  const mk = (value: number) => [{ rule: "n", file: "a.rs", line: 1, value }];
  const stable = stabilityReport([mk(0.9), mk(0.95), mk(0.88)], [rule]);
  assert.equal(stable.flipped.length, 0);
  assert.ok(stable.subjects[0]!.spread > 0, "a wobble away from the cutoff is not a flip");

  const flipping = stabilityReport([mk(0.49), mk(0.51)], [rule]);
  assert.equal(flipping.flipped.length, 1);
  assert.equal(flipping.rows[0]!.flipped, 1);
});
