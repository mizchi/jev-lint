import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { discoverEvals, scoreEval, compareEvals, relocateLabels, relocateRecord, runEval, readEvalRecord, draftsChanged, loadSuite, unanswered } from "../src/evals.ts";
import { loadRules } from "../src/rules.ts";
import { commitFixtureSubjects } from "../src/commits.ts";
import { noulRule, answer, changeRule } from "./builders.ts";
import { test, testAsync } from "./harness.ts";

const evalRule = (id: string, at: number) => noulRule({ id, at });

test("evals: a rule directory with expect.yml is an eval suite, and neither it nor its fixtures are rules", () => {
  // The layout: rules/<lang>/<id>/rule.yml beside expect.yml, fixtures/ and
  // baseline.json. The loader walks rules/ recursively, so expect.yml and
  // any .yml fixture would be read as rule files and fail validation -- the
  // loader skips both, and discovery finds exactly the directories that
  // carry an expect file.
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-evals-"));
  try {
    mkdirSync(join(dir, "typescript", "a", "fixtures"), { recursive: true });
    writeFileSync(join(dir, "typescript", "a", "rule.yml"), "id: a\nlanguage: TypeScript\nrule: { kind: function_declaration }\nask: q\n");
    writeFileSync(join(dir, "typescript", "a", "expect.yml"), "default: clean\nfixtures/x.ts:\n  - { line: 3, label: bad, reason: r }\n");
    writeFileSync(join(dir, "typescript", "a", "fixtures", "workflow.yml"), "not: a rule\n");
    mkdirSync(join(dir, "rust", "b"), { recursive: true });
    writeFileSync(join(dir, "rust", "b", "rule.yml"), "id: b\nlanguage: Rust\nrule: { kind: function_item }\nask: q\n");
    const { rules, errors } = loadRules([dir]);
    assert.deepEqual(errors, [], "expect.yml and fixtures/ must be invisible to the rule loader");
    assert.deepEqual(rules.map((r) => `${r.languageDir}/${r.id}`), ["rust/b", "typescript/a"]);
    const suites = discoverEvals([dir]);
    assert.equal(suites.length, 1, "only the directory with expect.yml is a suite");
    assert.equal(suites[0]!.name, "typescript/a", "named by language and id");
    assert.equal(suites[0]!.ruleFile, join(dir, "typescript", "a", "rule.yml"));
    assert.equal(suites[0]!.fixtures, join(dir, "typescript", "a", "fixtures"));
    assert.equal(suites[0]!.baseline, join(dir, "typescript", "a", "baseline.json"));
    // Loading the suite re-keys the expectations to the paths a run reports
    // and stamps the suite's rule on each, so `labelFor` needs no `rule:`.
    const loaded = loadSuite(suites[0]!);
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.labels.$default, "clean");
    assert.deepEqual(loaded.labels[join(dir, "typescript", "a", "fixtures", "x.ts")], [{ line: 3, label: "bad", reason: "r", rule: "a" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("evals: a baseline moves with its suite, keyed on what follows fixtures/", () => {
  // A rule promoted out of experiments/ carried its old paths in its
  // baseline, every labelled case then read as unlabelled, and --replay
  // could not tell: it compares decisions with the ones accepted, not
  // with the labels. Nine Go rules shipped that way before RULES.md's
  // generator scored them at precision 0.00.
  const suite = { name: "typescript/a", dir: "rules/typescript/a", ruleFile: "rules/typescript/a/rule.yml", fixtures: "rules/typescript/a/fixtures", expect: "rules/typescript/a/expect.yml", baseline: "", last: "" };
  const record = {
    schema: "jev-lint-eval-1", recorded: "2026-09-20", model: null, suite: "typescript/a", rules: [], cutoffs: {},
    passes: [[{ rule: "a", file: "experiments/rule-candidates/typescript/a/fixtures/sub/x.ts", line: 1, value: 0.9, confidence: null }]],
    spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
  };
  const moved = relocateRecord(record as never, suite);
  assert.equal(moved.passes[0]![0]!.file, "rules/typescript/a/fixtures/sub/x.ts");
  assert.equal(relocateRecord({ ...record, passes: [[{ ...record.passes[0]![0]!, file: "elsewhere/x.ts" }]] } as never, suite).passes[0]![0]!.file, "elsewhere/x.ts", "a path with no fixtures/ is left alone");
});

test("evals: expectations are written relative to the rule directory and resolved to the paths a run reports", () => {
  const labels = relocateLabels({ default: "clean", note: "n", "fixtures/cart.ts": [{ line: 3, label: "bad" }] }, "rules/typescript/a", "a");
  assert.equal(labels.$default, "clean");
  assert.equal(labels.$note, "n");
  assert.deepEqual(labels["rules/typescript/a/fixtures/cart.ts"], [{ line: 3, label: "bad", rule: "a" }]);
  assert.equal(labels["fixtures/cart.ts"], undefined);
  // The old spellings still read, so a hand-written file is not rejected
  // for a dollar sign.
  assert.equal(relocateLabels({ $default: "bad" }, "d", "a").$default, "bad");
});

test("evals: a suite is scored at the SHIPPED cutoff on the mean of its passes, with flips named", () => {
  // Not at a fitted cutoff: the question an eval answers is "does the rule as
  // shipped still get its cases right", and a fit would move the goalposts
  // to wherever the answers landed. The fit is reported beside it.
  const rules = [evalRule("a", 0.5)];
  const labels = { $default: "clean" as const, "rules/a/evals/cases/x.ts": [
    { line: 1, label: "bad" as const, rule: "a", window: 0 },
    { line: 2, label: "bad" as const, rule: "a", window: 0 },
    { line: 3, label: "clean" as const, rule: "a", window: 0, reason: "hard clean" },
  ] };
  const passes = [
    [answer("a", 1, 0.9), answer("a", 2, 0.45), answer("a", 3, 0.2), answer("a", 4, 0.1)],
    [answer("a", 1, 0.9), answer("a", 2, 0.55), answer("a", 3, 0.2), answer("a", 4, 0.1)],
    [answer("a", 1, 0.9), answer("a", 2, 0.56), answer("a", 3, 0.2), answer("a", 4, 0.1)],
  ];
  const score = scoreEval(passes, labels, rules);
  const a = score.rules.find((r) => r.rule === "a")!;
  assert.equal(a.at, 0.5);
  assert.equal(a.tp, 2, "the 0.45/0.55/0.56 defect has a mean of 0.52, over 0.5");
  assert.equal(a.fp, 0);
  assert.equal(a.fn, 0);
  assert.equal(a.precision, 1);
  assert.equal(a.recall, 1);
  assert.equal(a.flips, 1, "and it is a flip: in on two passes, out on one");
  assert.equal(a.subjects, 4, "unlabelled subjects count as clean, as in a corpus");
  assert.ok(typeof a.fitted === "number", "the fit is reported beside the shipped cutoff");
  assert.equal(a.cleanTop, 0.2, "and the top of the clean band, which is what a `loose:` floor should clear");
  const c = score.cases.find((c) => c.line === 2)!;
  assert.equal(c.label, "bad");
  assert.equal(c.decision, "flag");
  assert.equal(c.right, true);
  assert.ok(Math.abs(c.mean - 0.52) < 0.001);
  assert.deepEqual(c.values, [0.45, 0.55, 0.56]);
});

test("evals: comparing with a baseline names the cases that got worse, and a changed question", () => {
  const rules = [evalRule("a", 0.5)];
  const labels = { $default: "clean" as const, "rules/a/evals/cases/x.ts": [
    { line: 1, label: "bad" as const, rule: "a", window: 0 },
    { line: 2, label: "bad" as const, rule: "a", window: 0 },
    { line: 3, label: "clean" as const, rule: "a", window: 0 },
  ] };
  const before = scoreEval([[answer("a", 1, 0.9), answer("a", 2, 0.8), answer("a", 3, 0.2)]], labels, rules);
  const after = scoreEval([[answer("a", 1, 0.9), answer("a", 2, 0.3), answer("a", 3, 0.7), answer("a", 5, 0.9)]], labels, rules);
  const diff = compareEvals(before, after, { draftChanged: false });
  assert.deepEqual(diff.regressions.map((c) => `${c.line}:${c.was}->${c.now}`).sort(), ["2:flag->pass", "3:pass->flag"]);
  assert.deepEqual(diff.improvements, []);
  assert.deepEqual(diff.added.map((c) => c.line), [5], "a new subject the baseline never saw is reported, not judged");
  assert.equal(diff.ok, false);
  const unchanged = compareEvals(before, before, { draftChanged: false });
  assert.equal(unchanged.ok, true);
  // A rule whose sentence, criteria or matcher changed since the baseline is
  // a different question; its baseline answers cannot say anything about it.
  const stale = compareEvals(before, before, { draftChanged: true });
  assert.equal(stale.ok, false);
  assert.match(stale.reasons.join(" "), /question/i);
});

await testAsync("evals: a suite runs its rule over its cases, records every pass, and knows when its question changed", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-lint-evals-")));
  const ruleDir = join(dir, "typescript", "fn-name-promises");
  try {
    mkdirSync(join(ruleDir, "fixtures"), { recursive: true });
    writeFileSync(
      join(ruleDir, "rule.yml"),
      ["id: fn-name-promises", "language: TypeScript", "kind: noul", "at: 0.5",
       "rule: { kind: function_declaration, has: { field: name, pattern: $NAME } }",
       "ask: The body of this function does something other than what its name promises.",
       "criteria: { 'true': it does, 'false': it does not }"].join("\n"),
    );
    writeFileSync(join(ruleDir, "fixtures", "a.ts"), "export function isValid(x: string): string { return x; }\nexport function count(xs: string[]): number { return xs.length; }\n");
    writeFileSync(join(ruleDir, "expect.yml"), [
      "default: clean",
      "fixtures/a.ts:",
      "  - { line: 1, label: bad, window: 0, reason: reads as a predicate, returns a string }",
    ].join("\n"));
    const [suite] = discoverEvals([dir]);
    assert.ok(suite);
    // A fake model: 0.9 for the first question, 0.1 for the second, on every pass.
    let calls = 0;
    const client = {
      model: "fake", servedModel: "fake-1", spent: { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, ms: 0, retried: 0, splits: 0 },
      askSplitting: async (_state: unknown, questions: Record<string, unknown>) => {
        calls += 1;
        const names = Object.keys(questions);
        return { answers: Object.fromEntries(names.map((n, i) => [n, { type: "noul", noul: i === 0 ? 0.9 : 0.1 }])), usage: { input_tokens: 10 } };
      },
    };
    const record = await runEval(suite!, { repeat: 2, client });
    assert.equal(record.passes.length, 2);
    assert.equal(calls, 2, "one request per pass for a one-file suite");
    assert.equal(record.rules[0]!.draft.length, 12, "the record carries the rule's draft hash");
    assert.ok(existsSync(suite!.last), "the run is written to evals/last.json");
    const { rules, labels } = loadSuite(suite!);
    const score = scoreEval(record.passes, labels, rules);
    assert.equal(score.rules[0]!.tp, 1);
    assert.equal(score.rules[0]!.fp, 0);
    assert.equal(score.rules[0]!.fn, 0);
    assert.deepEqual(draftsChanged(readEvalRecord(suite!.last)!, rules), [], "same question, same draft");
    // Reword the rule: the record is now an answer to a different question.
    writeFileSync(join(ruleDir, "rule.yml"), readFileSync(join(ruleDir, "rule.yml"), "utf8").replace("other than", "different from"));
    assert.deepEqual(draftsChanged(readEvalRecord(suite!.last)!, loadSuite(suite!).rules), ["fn-name-promises"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("evals: comparing two records names the case that got worse, and only that one", () => {
  // Two models, two days, two revisions of a sentence: the comparison is the
  // same as against a baseline, except that neither side is the contract, so
  // a changed question is reported rather than refused (that part is the
  // command's, above the module, and is not asserted here).
  const rules = [evalRule("a", 0.5)];
  const labels = { $default: "clean" as const, "rules/a/evals/cases/x.ts": [
    { line: 1, label: "bad" as const, rule: "a", window: 0 },
    { line: 2, label: "clean" as const, rule: "a", window: 0 },
  ] };
  const left = scoreEval([[answer("a", 1, 0.9), answer("a", 2, 0.2)]], labels, rules);
  const right = scoreEval([[answer("a", 1, 0.3), answer("a", 2, 0.2)]], labels, rules);
  const diff = compareEvals(left, right, { draftChanged: false });
  assert.equal(diff.regressions.length, 1);
  assert.equal(diff.regressions[0]!.line, 1);
  assert.equal(diff.improvements.length, 0);
});

await testAsync("evals: a suite whose expect file does not parse reports it, and planning or generating from it stops there", async () => {
  const { loadSuite, planEval, discoverEvals, evalCorpus } = await import("../src/evals.ts");
  const { collectRows } = await import("../tools/rules-md.ts");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-bad-suite-")));
  try {
    const ruleDir = join(dir, "typescript", "r");
    mkdirSync(join(ruleDir, "fixtures"), { recursive: true });
    writeFileSync(
      join(ruleDir, "rule.yml"),
      ["id: r", "language: TypeScript", "kind: noul", "at: 0.5", "rule: { kind: function_declaration }", "ask: x.", "criteria: { 'true': a, 'false': b }"].join("\n"),
    );
    writeFileSync(join(ruleDir, "fixtures", "a.ts"), "export function a() {}\n");
    writeFileSync(join(ruleDir, "expect.yml"), "default: clean\nfixtures/a.ts: [ { line: 1, label: bad ]\n");
    const [suite] = discoverEvals([dir]);
    assert.ok(suite);
    const loaded = loadSuite(suite!);
    assert.equal(loaded.errors.length, 1);
    assert.match(loaded.errors[0]!, /expect\.yml/);
    await assert.rejects(() => planEval(suite!), /expect\.yml/);
    // The experiments' corpus still scans the suite's cases and says the
    // labels are missing, rather than dropping the suite without a word.
    // A record that is not one -- unreadable, or another schema -- is null,
    // and a baseline that is null is "no baseline", never an exception.
    assert.equal(readEvalRecord(join(dir, "missing.json")), null);
    writeFileSync(join(dir, "other.json"), JSON.stringify({ schema: "jev-lint-run-1", passes: [] }));
    assert.equal(readEvalRecord(join(dir, "other.json")), null);
    writeFileSync(join(dir, "garbage.json"), "{");
    assert.equal(readEvalRecord(join(dir, "garbage.json")), null);
    const corpus = evalCorpus([dir]);
    assert.deepEqual(corpus.paths, [suite!.fixtures]);
    assert.equal(corpus.errors.length, 1);
    assert.match(corpus.errors[0]!, /expect\.yml/);
    // And a rule that does not load is the generator's error, not a row.
    writeFileSync(join(ruleDir, "rule.yml"), "id: r\nlanguage: TypeScript\n");
    assert.throws(() => collectRows(dir), /ask|rule/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("evals: a subject a pass never answered is counted, because nothing else counts it", () => {
  // A batch whose request fails yields a null answer per subject -- fail
  // open, so the gate records `missing` rather than a clean bill of health.
  // `scoreEval` then computes precision and recall over whatever came back,
  // and NOTHING in the summary line distinguishes a suite that answered ten
  // subjects from one that answered three and lost seven to HTTP 529. One
  // agent calibrating the shell pack read `P 1.00 R 0.67` off three of ten;
  // in the whole-run case a baseline of nothing replays as "all as shipped"
  // with tp, fp and fn all zero. This is the number that makes that visible.
  const full = [
    [answer("a", 1, 0.9), answer("a", 2, 0.1)],
    [answer("a", 1, 0.88), answer("a", 2, 0.12)],
  ];
  assert.equal(unanswered(full), 0);
  const holed = [
    [answer("a", 1, 0.9), { ...answer("a", 2, 0), value: null }],
    [{ ...answer("a", 1, 0), value: null }, { ...answer("a", 2, 0), value: null }],
  ];
  assert.equal(unanswered(holed), 3, "counted per pass, not per subject");
  assert.equal(unanswered([]), 0, "a record with no passes has nothing missing, and no answers either");
});

test("evals: a change rule's fixtures become commits, each judged by its own AGENTS.md", () => {
  const suite = mkdtempSync(join(tmpdir(), "jev-change-suite-"));
  try {
    const one = join(suite, "fixtures", "forbidden");
    mkdirSync(join(one, "before"), { recursive: true });
    mkdirSync(join(one, "after"), { recursive: true });
    writeFileSync(join(one, "message"), "Colour the output\n");
    writeFileSync(join(one, "before", "AGENTS.md"), "- No runtime dependencies.\n");
    writeFileSync(join(one, "after", "AGENTS.md"), "- No runtime dependencies.\n");
    writeFileSync(join(one, "before", "package.json"), '{ "dependencies": {} }\n');
    writeFileSync(join(one, "after", "package.json"), '{ "dependencies": { "chalk": "^5" } }\n');
    const subjects = commitFixtureSubjects([changeRule()], join(suite, "fixtures"));
    assert.equal(subjects.length, 1);
    assert.match(subjects[0]!.file, /forbidden$/, "named by its case directory, which is what expect.yml keys on");
    assert.match(subjects[0]!.instructions!.docs[0]!.text, /No runtime dependencies/);
    assert.match(subjects[0]!.commit!.diff, /chalk/);
  } finally {
    rmSync(suite, { recursive: true, force: true });
  }
});
