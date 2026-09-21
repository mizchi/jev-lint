import { strict as assert } from "node:assert";
import { planBatches, planRuleBatches, estimateTokens, MAX_STATE_TOKENS, STATE_BUDGET, REQUEST_BUDGET, STATE_MARGIN, REQUEST_MARGIN, DEFAULT_BATCH_SIZE } from "../src/batch.ts";
import { schedule } from "../src/schedule.ts";
import { scoreRule, subjectOf, sampleEntry, manySubjects, commitRule, changeRule } from "./builders.ts";
import { test } from "./harness.ts";

test("batch: every subject lands in exactly one batch and none is empty", () => {
  const subjects = manySubjects(700);
  const batches = planBatches(subjects, {
    sources: new Map([["a.ts", "source"]]),
    symbols: new Map([["a.ts", sampleEntry()]]),
  });
  // "Exactly one" is a claim about identity, not about a count: 700 placements
  // could be 699 subjects with one of them twice. jev-lint flagged the count-only
  // version of this test at 0.55 against a 0.54 cutoff, and it was right.
  // By text, not by reference: the planner hands out copies with ids assigned.
  const placed = batches.flatMap((b) => b.subjects.map((s) => s.text));
  assert.equal(placed.length, subjects.length);
  assert.equal(new Set(placed).size, subjects.length, "no subject is placed twice");
  const wanted = new Set(subjects.map((s) => s.text));
  assert.ok(placed.every((t) => wanted.has(t)), "nothing is placed that was not asked for");
  assert.ok(batches.every((b) => b.subjects.length > 0));
  assert.ok(batches.every((b) => b.subjects.length <= DEFAULT_BATCH_SIZE));
});

// The name carries the planner's exception, because the body has to: a batch
// holding ONE subject is allowed over the ceiling, there being nothing left to
// split. Named "no batch exceeds the request ceiling", jev-lint kept flagging it
// at 0.54-0.62 against a 0.54 cutoff, and on that reading it was right -- the
// gap was between the name and the contract, not in the assertions.
test("batch: no splittable batch exceeds either budget", () => {
  const subjects = manySubjects(400, { text: "x".repeat(800) });
  const batches = planBatches(subjects, {
    sources: new Map([["a.ts", "source"]]),
    symbols: new Map(),
  });
  // This guard is the point of the assertion below. Without it, a planner that
  // returned one subject per batch would satisfy the loop vacuously and this
  // test would pass while verifying nothing about the ceiling.
  //
  // This weakness was found by running jev-lint on its own test suite:
  // `test-name-matches-body` scored the original 0.68-0.73 across runs against
  // a 0.69 cutoff, for precisely this reason. The model was right.
  const multi = batches.filter((b) => b.subjects.length > 1);
  assert.ok(multi.length > 0, "the planner must actually group subjects for this to test anything");
  // And then EVERY batch, not just the grouped ones. Checking only `multi` was
  // the second weakness jev-lint found here (0.74 against a 0.54 cutoff): the
  // name says no batch, and a one-subject batch over the ceiling is exactly
  // the case the planner is allowed to emit only when it cannot split further.
  //
  // Against the BUDGETS, not the ceilings. The ceilings are what the server
  // enforces; the budgets are the ceilings less the margin that absorbs the
  // estimate's undercount. A planner that packed to the ceiling would pass a
  // ceiling assertion here and lose verdicts on the server, which is the exact
  // regression the margins were added to stop -- so it has to fail here.
  for (const b of batches) {
    if (b.subjects.length === 1) continue; // irreducible: nothing left to split
    assert.ok(
      b.estimatedTokens <= REQUEST_BUDGET,
      `batch of ${b.subjects.length} estimated ${b.estimatedTokens}, over the ${REQUEST_BUDGET} budget`,
    );
    assert.ok(
      estimateTokens(b.state) <= STATE_BUDGET,
      `state of a ${b.subjects.length}-subject batch estimated ${estimateTokens(b.state)}, over the ${STATE_BUDGET} budget`,
    );
  }
});

test("batch: many matches split the batch; only much source degrades the arm", () => {
  // The distinction the planner got wrong until jev-lint was run on it. The arm
  // is decided by the part of a state a split cannot shrink, so:
  //   many subjects, small file -> split, arm intact
  //   one subject, huge file    -> cannot split, arm steps down
  const fromManyMatches = planBatches(manySubjects(400, { arm: "bare", text: "x".repeat(400) }), {
    sources: new Map([["a.ts", "source"]]),
    symbols: new Map(),
  });
  assert.ok(fromManyMatches.length > 1, "a group this size has to be split");
  for (const b of fromManyMatches) {
    assert.equal(b.arm, "bare");
    assert.equal(b.degraded, null, "splitting is not a loss of context and must not be reported as one");
    assert.ok(estimateTokens(b.state) <= STATE_BUDGET, "split, and split to the budget, not the ceiling");
  }

  const fromHugeSource = planBatches(manySubjects(2, { arm: "located" }), {
    sources: new Map([["a.ts", "s".repeat(MAX_STATE_TOKENS * 4)]]),
    symbols: new Map(),
  });
  for (const b of fromHugeSource) {
    assert.notEqual(b.arm, "located", "a source that cannot fit must not be sent as if it had");
    assert.ok(b.degraded, "and that step-down is a real loss, so it is reported");
    assert.equal(b.degraded!.from, "located");
  }
});

test("batch: subjects are grouped per file and per arm, never mixed", () => {
  const subjects = [
    subjectOf({ file: "a.ts", arm: "bare" }),
    subjectOf({ file: "a.ts", arm: "located" }),
    subjectOf({ file: "b.ts", arm: "bare" }),
  ];
  const batches = planBatches(subjects, { sources: new Map(), symbols: new Map() });
  assert.equal(batches.length, 3);
  for (const b of batches) {
    assert.equal(new Set(b.subjects.map((s) => s.arm)).size, 1);
    assert.equal(new Set(b.subjects.map((s) => s.file)).size, 1);
  }
});

test("batch: question ids match the state's subject index", () => {
  const batches = planBatches(manySubjects(3), {
    sources: new Map([["a.ts", "s"]]),
    symbols: new Map(),
  });
  const b = batches[0]!;
  assert.deepEqual(Object.keys(b.questions), ["q0000", "q0001", "q0002"]);
  assert.deepEqual(
    b.state.subjects.map((s) => s.id),
    Object.keys(b.questions),
  );
});

test("batch: a file too large for the state budget steps the arm down and says so", () => {
  const huge = "x".repeat(200_000);
  const batches = planBatches(manySubjects(2, { arm: "located" }), {
    sources: new Map([["a.ts", huge]]),
    symbols: new Map([["a.ts", sampleEntry()]]),
  });
  assert.ok(batches.every((b) => b.arm !== "located"));
  assert.ok(batches.every((b) => b.degraded));
  assert.equal(batches[0]!.degraded!.from, "located");
  // A step-down is a real loss of context, so it must be visible.
  assert.match(batches[0]!.degraded!.reason, /state budget/);
});

test("batch: the paired arm carries the file's tests, steps down to local, and never survives the rule axis", () => {
  const tests = new Map([["a.ts", [{ path: "a.test.ts", via: "import" as const, code: "it('x', () => {})" }]]]);
  const [batch] = planBatches(manySubjects(2, { arm: "paired", file: "a.ts" }), {
    sources: new Map([["a.ts", "src"]]),
    symbols: new Map([["a.ts", sampleEntry()]]),
    tests,
  });
  assert.equal(batch!.arm, "paired");
  assert.deepEqual(batch!.state.related_tests, [{ path: "a.test.ts", paired_by: "it imports this file", code: "it('x', () => {})" }]);

  // Tests too large for the state: the arm steps down to local and says so.
  const huge = new Map([["a.ts", [{ path: "a.test.ts", via: "name" as const, code: "x".repeat(200_000) }]]]);
  const [down] = planBatches(manySubjects(2, { arm: "paired", file: "a.ts" }), {
    sources: new Map([["a.ts", "src"]]),
    symbols: new Map([["a.ts", sampleEntry()]]),
    tests: huge,
  });
  assert.equal(down!.arm, "local");
  assert.equal(down!.degraded!.from, "paired");
  assert.equal(down!.state.related_tests, undefined);

  // Under rule grouping the state spans files, so it cannot carry one file's tests.
  for (const b of planRuleBatches(manySubjects(4, { arm: "paired" }), { symbols: new Map() })) {
    assert.equal(b.arm, "local");
    assert.equal(b.degraded!.from, "paired");
  }
  // Which is why the scheduler pins it to the file axis, like located.
  const needsTests = scoreRule({ id: "needs-tests", state: "paired" });
  const s = schedule(manySubjects(4, { rule: needsTests, arm: "paired", file: "a.ts" }), [needsTests], {
    sources: new Map(),
    symbols: new Map(),
  });
  assert.equal(s.decisions[0]!.axis, "file");
  assert.equal(s.decisions[0]!.pinned, true);
});

test("batch: the token estimate is pessimistic rather than optimistic", () => {
  // The estimator must not under-count. Under-counting the REQUEST costs a
  // round trip to discover; under-counting the STATE costs the verdicts, since
  // splitting the questions cannot shrink a state.
  const text = "a".repeat(3400);
  assert.ok(estimateTokens(text) >= 1000);
  assert.ok(estimateTokens({ a: "b" }) > 0);
  assert.ok(estimateTokens("") <= 2, "an empty payload is two quotes, not a page");
});

test("batch: the state is packed to a wider margin than the request", () => {
  // Not a style preference: the two budgets fail differently. A request over
  // budget is recovered by halving the questions; a state over budget is not
  // recoverable at all, and a run that hit it lost 100 verdicts. The estimate
  // is also 12% under on a metadata-only state and 15-26% OVER on questions,
  // so the margins have to differ in this direction and by at least that much.
  assert.ok(STATE_MARGIN > REQUEST_MARGIN, "the unrecoverable budget gets the wider margin");
  assert.ok(STATE_MARGIN >= 1.12, "and enough of one to cover a 12% undercount");
});

test("batch: structured records are charged more per character than prose", () => {
  // Measured against the server's own accounting: source text runs about 3.4
  // characters per token and per-subject metadata records about 2.2, because
  // the records are mostly short quoted keys and punctuation. Charging one
  // ratio for both undercounted a metadata-heavy state by 36% and lost the
  // verdicts in it. Same character count, two shapes:
  const asProse = { source: "x".repeat(2000) };
  const asRecords = Array.from({ length: 40 }, (_, i) => ({
    id: `q${i}`,
    rule: "some-rule-id",
    node: "variable_declarator",
    lines: `${i}`,
  }));
  const proseChars = JSON.stringify(asProse).length;
  const recordChars = JSON.stringify(asRecords).length;
  const perChar = (v: unknown, chars: number) => estimateTokens(v) / chars;
  assert.ok(
    perChar(asRecords, recordChars) > perChar(asProse, proseChars) * 1.4,
    `records ${perChar(asRecords, recordChars).toFixed(3)} tok/char should cost well over ` +
      `prose ${perChar(asProse, proseChars).toFixed(3)}`,
  );
});

test("batch/rule: every subject lands in exactly one batch, grouped per rule", () => {
  const a = scoreRule({ id: "a" });
  const b = scoreRule({ id: "b" });
  const subjects = [
    ...manySubjects(5, { rule: a, file: "x.ts" }),
    ...manySubjects(7, { rule: b, file: "y.ts" }),
    ...manySubjects(3, { rule: a, file: "z.ts" }),
  ];
  const batches = planRuleBatches(subjects, { symbols: new Map() });
  // Counting to 15 was the whole check here, and a count cannot see "exactly
  // one": a subject duplicated into two batches while another is dropped still
  // totals 15. jev-lint flagged the name against the body for that (0.77 on a
  // 0.54 cutoff), so the subjects are now identified rather than tallied.
  const placements = new Map<string, number>();
  for (const x of batches) {
    for (const s of x.subjects) {
      const key = `${s.rule.id}\u0000${s.file}\u0000${s.line}\u0000${s.text}`;
      placements.set(key, (placements.get(key) ?? 0) + 1);
    }
  }
  assert.equal(placements.size, 15, "every subject appears");
  for (const [key, times] of placements) {
    assert.equal(times, 1, `${key.replaceAll("\u0000", " ")} landed in ${times} batches`);
  }
  assert.ok(batches.every((x) => x.subjects.length > 0));
  // "Grouped" has to mean something: 15 batches of one subject each would
  // satisfy every assertion above and group nothing. jev-lint kept flagging the
  // name over this even after the placement check went in, and it was right.
  assert.ok(
    batches.some((x) => x.subjects.length > 1),
    "the planner must actually group, not emit one batch per subject",
  );
  // "Grouped per rule" is a claim about the batch COUNT: two rules, two
  // batches, whatever files the subjects came from. Asserting only that no
  // batch mixes rules left "rule a spread over three batches" passing.
  assert.equal(batches.length, 2, "one batch per rule, since neither rule fills a batch");
  // A rule-axis state is one rule's matches, so a batch never mixes rules --
  // the questions in it share one sentence and one criteria block.
  for (const x of batches) {
    assert.equal(new Set(x.subjects.map((s) => s.rule.id)).size, 1);
    assert.equal(x.group, "rule");
  }
  // And it DOES mix files, which is the entire point of the axis.
  const spanning = batches.find((x) => new Set(x.subjects.map((s) => s.file)).size > 1);
  assert.ok(spanning, "a rule-axis batch should span files");
});

test("batch/rule: the cap is honoured and the state budget closes a batch", () => {
  const subjects = manySubjects(100, { arm: "bare" });
  const capped = planRuleBatches(subjects, { batchSize: 8, symbols: new Map() });
  assert.ok(capped.every((b) => b.subjects.length <= 8));
  assert.equal(capped.reduce((n, b) => n + b.subjects.length, 0), 100);

  // Two different budgets close a rule-axis batch, and which one depends on the
  // arm -- a distinction worth pinning, because the code lives in the QUESTIONS
  // and only `local` context lives in the state.
  //
  // On `bare`, the state barely grows per subject, so the REQUEST budget binds.
  const wide = planRuleBatches(manySubjects(400, { arm: "bare", text: "x".repeat(3000) }), {
    batchSize: 256,
    symbols: new Map(),
  });
  assert.ok(wide.length > 1, "big questions must close a batch on the request budget");
  for (const b of wide) {
    if (b.subjects.length > 1) {
      assert.ok(
        b.estimatedTokens <= REQUEST_BUDGET,
        `batch of ${b.subjects.length} on arm ${b.arm} estimated ${b.estimatedTokens}, over the ${REQUEST_BUDGET} budget`,
      );
    }
  }
  assert.equal(wide.reduce((n, b) => n + b.subjects.length, 0), 400);

  // On `local`, each subject contributes its enclosing function to the state,
  // so the STATE budget binds -- and it binds first, being half the size.
  const deep = planRuleBatches(
    Array.from({ length: 60 }, (_, i) =>
      subjectOf({
        arm: "local",
        line: i + 1,
        endLine: i + 1,
        text: `call${i}()`,
        // Distinct per subject, or the state deduplicates them into one entry.
        context: `function ctx${i}() { ${"y".repeat(3000)} }`,
        contextName: `ctx${i}`,
      }),
    ),
    { batchSize: 256, symbols: new Map() },
  );
  assert.ok(deep.length > 1, "accumulated context must close a batch on the state budget");
  assert.equal(deep.reduce((n, b) => n + b.subjects.length, 0), 60);
  for (const b of deep) {
    if (b.subjects.length > 1) {
      assert.ok(
        b.estimatedTokens <= REQUEST_BUDGET,
        `local batch of ${b.subjects.length} estimated ${b.estimatedTokens}, over the ${REQUEST_BUDGET} budget`,
      );
    }
  }
  // Which budget closed it is the actual claim in this test's name, and
  // "a batch closed" does not establish it -- the request budget would have
  // closed one too. jev-lint flagged the name over exactly that, so: the state
  // is at its own ceiling while the request total is nowhere near its own.
  const bound = deep.find((b) => b.subjects.length > 1)!;
  assert.ok(
    estimateTokens(bound.state) <= STATE_BUDGET,
    `state ${estimateTokens(bound.state)} must stay under its own budget of ${STATE_BUDGET}`,
  );
  assert.ok(
    estimateTokens(bound.state) > STATE_BUDGET / 2,
    "and must be near it, or something other than the state closed this batch",
  );
  assert.ok(
    bound.estimatedTokens < REQUEST_BUDGET * 0.9,
    `the request budget must have room left (${bound.estimatedTokens} of ${REQUEST_BUDGET}), or it is what bound`,
  );
});

test("batch/rule: a file-bearing arm is recorded as degraded, with its reason", () => {
  // This is the axis's real cost, so it must be visible rather than silent.
  const batches = planRuleBatches(manySubjects(4, { arm: "located" }), { symbols: new Map() });
  assert.ok(batches.length > 0);
  for (const b of batches) {
    assert.equal(b.arm, "local", "located cannot survive a state that spans files");
    assert.ok(b.degraded, "the step-down must be recorded");
    assert.equal(b.degraded!.from, "located");
    assert.equal(b.degraded!.to, "local");
    assert.match(b.degraded!.reason, /spans files/);
  }
});

test("batch: a batch stamps its effective arm onto its subjects", () => {
  // Downstream consumers read subject.arm -- the finding, the cache provenance,
  // the replay record. Leaving the rule's DECLARED arm there made every
  // rule-axis verdict claim `located` for a question asked at `local`.
  const ruleAxis = planRuleBatches(manySubjects(3, { arm: "located" }), { symbols: new Map() });
  for (const b of ruleAxis) {
    assert.ok(b.subjects.every((s) => s.arm === b.arm));
    assert.ok(b.subjects.every((s) => s.arm === "local"));
  }
  const fileAxis = planBatches(manySubjects(3, { arm: "located" }), {
    sources: new Map([["a.ts", "source"]]),
    symbols: new Map(),
  });
  for (const b of fileAxis) assert.ok(b.subjects.every((s) => s.arm === b.arm));
});

test("batch: a commit and a change subject over one commit do not share a state", () => {
  // They share an arm (`bare`) and a file (the sha), which is the whole
  // grouping key for the file axis, so they used to land in one batch. The
  // two states are different documents -- one says the message is judged
  // and carries it, the other says the diff is judged and carries the
  // instruction documents it is judged against -- and `buildState` reads
  // `subjects[0]`, so the change rule was asked its question against a
  // state with no instructions in it. A model handed no standard answers
  // anyway, so nothing failed; it just answered about nothing.
  const diff = { files: ["cart.ts"], stat: " 1 file changed", diff: "d", truncated: false };
  const shared = { file: "abc1234", line: 1, endLine: 1, arm: "bare" as const, language: "Git", enclosing: null, promoted: false, captured: {} };
  const commit = subjectOf({ ...shared, rule: commitRule(), text: "Add cart", nodeKind: "commit", commit: diff });
  const change = subjectOf({ ...shared, rule: changeRule(), text: " 1 file changed", nodeKind: "change", commit: diff, instructions: { docs: [{ file: "AGENTS.md", text: "- x\n" }], truncated: false } });
  const batches = planBatches([commit, change]);
  assert.equal(batches.length, 2, "one batch each, not one batch of both");
  const byKind = Object.fromEntries(batches.map((b) => [b.subjects[0]!.rule.subject, b.state]));
  assert.ok(byKind.change!.instructions, "the change batch carries what its rule is judged against");
  assert.equal(byKind.change!.message, undefined);
  assert.equal(byKind.commit!.instructions, undefined);
  assert.equal(byKind.commit!.message, "Add cart");
});
