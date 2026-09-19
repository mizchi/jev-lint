import assert from "node:assert/strict";
import { normalizeRule, loadRuleFile } from "../src/rules.ts";
import { planBatches, planRuleBatches, MAX_STATE_TOKENS } from "../src/batch.ts";
import { manySubjects } from "./helpers.ts";

let passed = 0;
let failCount = 0;
const only = process.argv[2] ?? null;

function test(name: string, fn: () => void): void {
  if (only && !name.includes(only)) return;
  try {
    fn();
    passed++;
  } catch (e) {
    failCount++;
    console.error(`x ${name}\n`, e);
  }
}

test("rules: a nested rule is normalized to one matcher", () => {
  const flat = normalizeRule({
    id: "r",
    language: "TypeScript",
    rule: { all: [{ kind: "identifier" }] },
    ask: "x",
  });
  assert.ok(flat.rule, "a well-formed rule loads");
  assert.equal(flat.rule!.rule.all[0].kind, "identifier");
});

test("rules: a rule without an ask is rejected", () => {
  const flat = normalizeRule({ id: "r", language: "TypeScript", rule: { kind: "identifier" } });
  assert.equal(flat.rule, undefined);
  assert.match(flat.error!, /missing `ask`/);
});

test("rules: fixtures that load, and fixtures that must not", () => {
  const ok = ["one.yml", "anchors.yml", "two-grammars.yml"];
  const bad = ["no-ask.yml", "both-languages.yml", "flat-criteria.yml"];
  for (const f of ok) assert.ok(loadRuleFile(`test/fixtures/${f}`).rule, f);
  for (const f of bad) assert.ok(loadRuleFile(`test/fixtures/${f}`).error, f);
});

test("rules: a rejected rule names its id first", () => {
  const ok = normalizeRule({ id: "typo", language: "TypeScript", rule: { kind: "identifier" } });
  assert.match(ok.error!, /^typo:/);
});

test("batch: a source that cannot fit steps the arm down", () => {
  const fromHugeSource = planBatches(manySubjects(2, { arm: "located" }), {
    sources: new Map([["a.ts", "s".repeat(MAX_STATE_TOKENS * 4)]]),
    symbols: new Map(),
  });
  for (const b of fromHugeSource) {
    assert.notEqual(b.arm, "located", "a source that cannot fit must not be sent as if it had");
    assert.ok(b.degraded, "and that step-down is a real loss, so it is reported");
  }
});

test("batch/rule: a rule-axis batch spans files", () => {
  const subjects = [...manySubjects(4, { file: "a.ts" }), ...manySubjects(4, { file: "b.ts" })];
  const batches = planRuleBatches(subjects, { batchSize: 32, symbols: new Map() });
  const spanning = batches.find((b) => new Set(b.subjects.map((s) => s.file)).size > 1);
  assert.ok(spanning, "a rule-axis batch should span files");
  const files = spanning!.subjects.map((s) => s.rule.id);
  assert.equal(new Set(files).size, 1, "a rule-axis batch carries one rule");
});

test("batch: every subject lands in exactly one batch", () => {
  const subjects = manySubjects(700, { arm: "bare" });
  const placed = planBatches(subjects, { sources: new Map(), symbols: new Map() }).flatMap((b) => b.subjects);
  const seen = new Set(placed);
  assert.equal(seen.size, subjects.length, "no subject placed twice");
  assert.equal(placed.length, subjects.length, "no subject dropped");
});

process.stdout.write(`\n${passed} passed, ${failCount} failed\n`);
process.exit(failCount === 0 ? 0 : 1);
