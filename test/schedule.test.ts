import { strict as assert } from "node:assert";
import { schedule, planMixed, explain } from "../src/schedule.ts";
import type { Rule } from "../src/types.ts";
import { test, scoreRule, subjectOf, manySubjects } from "./helpers.ts";

test("schedule: a file-bearing arm holds its rule on the file axis", () => {
  // The constraint that protects accuracy. It is structural: the rule axis
  // cannot carry a file, so a rule whose evidence IS the file would lose it.
  const needsFile = scoreRule({ id: "needs-file", state: "located" });
  const fine = scoreRule({ id: "fine", state: "bare" });
  const s = schedule(
    [
      ...manySubjects(4, { rule: needsFile, arm: "located", file: "a.ts" }),
      ...manySubjects(4, { rule: fine, arm: "bare", file: "b.ts" }),
    ],
    [needsFile, fine],
    { sources: new Map(), symbols: new Map() },
  );
  const held = s.decisions.find((d) => d.rule === "needs-file")!;
  assert.equal(held.axis, "file");
  assert.equal(held.pinned, true);
  assert.match(held.reason, /needs the file/);
  // A rule with no file-bearing arm is left for cost to decide.
  assert.equal(s.decisions.find((d) => d.rule === "fine")!.pinned, false);
});

test("schedule: a rule's own axis pin is never overruled", () => {
  // "Never overruled" is only shown by a case the scheduler decides the other
  // way on its own. jev-lint flagged the earlier version for asserting the pin
  // held without establishing that, and writing the stronger version found the
  // assumed premise to be false: for a rule on a lean arm the rule axis is
  // ALWAYS cheaper, since the file axis pays one request per file for exactly
  // the same content. So the disagreeing direction is a `file` pin.
  const layout = (rule: Rule) =>
    [0, 1, 2, 3].map((i) => subjectOf({ rule, arm: "bare", file: `f${i}.ts`, line: i + 1 }));
  const options = { sources: new Map<string, string>(), symbols: new Map() };

  const unpinned = scoreRule({ id: "same-shape", state: "bare" });
  const byCostAlone = schedule(layout(unpinned), [unpinned], options).decisions[0]!;
  assert.equal(byCostAlone.axis, "rule", "the premise: cost prefers the rule axis for this shape");
  assert.equal(byCostAlone.pinned, false);

  const pinnedToFile = scoreRule({ id: "pinned-file", state: "bare", axis: "file" });
  const againstCost = schedule(layout(pinnedToFile), [pinnedToFile], options).decisions[0]!;
  assert.equal(againstCost.axis, "file", "the pin wins against the cheaper axis");
  assert.equal(againstCost.pinned, true);
  assert.match(againstCost.reason, /pinned/);

  // And a pin in the direction cost already agrees with is still recorded as a
  // pin, not as a cost decision that happened to match.
  const pinnedToRule = scoreRule({ id: "pinned-rule", state: "bare", axis: "rule" });
  const withCost = schedule(layout(pinnedToRule), [pinnedToRule], options).decisions[0]!;
  assert.equal(withCost.axis, "rule");
  assert.equal(withCost.pinned, true);
  assert.match(withCost.reason, /pinned/);
});

test("schedule: the axis decision does not depend on what was cached", () => {
  // The axis is part of the cache key, so deciding it again on the uncached
  // remainder would store a verdict under the key of an axis it was not asked
  // on. Measured flipping both movable rules at 50%, 25% and 10% remaining.
  const r = scoreRule({ id: "free", state: "bare" });
  const all = manySubjects(40, { rule: r, arm: "bare" });
  const ctx = { sources: new Map(), symbols: new Map() };
  const full = schedule(all, [r], ctx);
  for (const remaining of [20, 10, 4]) {
    const partial = schedule(all.slice(0, remaining), [r], ctx);
    assert.deepEqual(
      [...partial.fileAxisRules].sort(),
      [...full.fileAxisRules].sort(),
      `axis assignment moved with ${remaining} subjects remaining`,
    );
  }
});

test("schedule: planMixed puts each subject on exactly one axis", () => {
  const a = scoreRule({ id: "a", state: "bare" });
  const b = scoreRule({ id: "b", state: "bare" });
  const subjects = [
    ...manySubjects(5, { rule: a, arm: "bare", file: "a.ts" }),
    ...manySubjects(5, { rule: b, arm: "bare", file: "b.ts" }),
  ];
  const batches = planMixed(subjects, new Set(["a"]), {
    sources: new Map([["a.ts", "s"], ["b.ts", "s"]]),
    symbols: new Map(),
  });
  assert.equal(batches.reduce((n, x) => n + x.subjects.length, 0), 10);
  const aBatches = batches.filter((x) => x.subjects[0]!.rule.id === "a");
  const bBatches = batches.filter((x) => x.subjects[0]!.rule.id === "b");
  assert.ok(aBatches.every((x) => x.group !== "rule"), "rule a was assigned the file axis");
  assert.ok(bBatches.every((x) => x.group === "rule"), "rule b was left on the rule axis");
});

test("schedule: its cost report covers the same subjects as its plan", () => {
  // The three cost rows used to be printed beside a plan built over a different
  // subject set, and disagreed with it by 16% on tokio.
  const r = scoreRule({ id: "r", state: "bare" });
  const subjects = manySubjects(12, { rule: r, arm: "bare" });
  const s = schedule(subjects, [r], { sources: new Map(), symbols: new Map() });
  assert.equal(s.plannedOver, 12);
  assert.equal(
    s.chosen.tokens,
    s.batches.reduce((a, b) => a + b.estimatedTokens, 0),
  );
  assert.equal(s.chosen.requests, s.batches.length);
  assert.match(explain(s), /over 12 subject\(s\)/);
});
