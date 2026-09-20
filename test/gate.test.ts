import { strict as assert } from "node:assert";
import { decide, gate, describe as describeFinding, blocks, looseFloor } from "../src/gate.ts";
import { formatPretty } from "../src/report.ts";
import { cutoffFor } from "../src/rules.ts";
import type { Finding } from "../src/types.ts";
import { test, scoreRule, noulRule, subjectOf, answer } from "./helpers.ts";

test("gate: score findings fire at the cutoff and are named by level", () => {
  const rule = scoreRule({ at: 2 });
  const below = decide(subjectOf({ rule }), { value: 1.99, confidence: 0.9, kind: "score" });
  assert.equal(below.reported, false);
  const onTheCutoff = decide(subjectOf({ rule }), { value: 2.0, confidence: 0.9, kind: "score" });
  assert.equal(onTheCutoff.reported, true);
  assert.equal(onTheCutoff.messageId, "violation");
  assert.equal(onTheCutoff.level, "arguable");
  const high = decide(subjectOf({ rule }), { value: 2.9, confidence: 0.9, kind: "score" });
  assert.equal(high.level, "violation");
});

test("gate: the stats count findings and subjects per file, and --summary prints the densest first", () => {
  // Forty-two findings over a tree read as noise until they were grouped:
  // eight of one rule were one idiom in six modules, sixteen of another
  // were one test file too big to excerpt. The grouping is in the stats,
  // and `--summary` prints it, so the reader gets the clusters and not
  // the list.
  const rule = noulRule({ id: "r", at: 0.5 });
  const other = noulRule({ id: "s", at: 0.5 });
  const g = gate([
    { subject: subjectOf({ rule, file: "src/a.ts", line: 1 }), answer: { value: 0.9, confidence: null, kind: "noul" } },
    { subject: subjectOf({ rule, file: "src/a.ts", line: 5 }), answer: { value: 0.1, confidence: null, kind: "noul" } },
    { subject: subjectOf({ rule: other, file: "src/a.ts", line: 9 }), answer: { value: 0.9, confidence: null, kind: "noul" } },
    { subject: subjectOf({ rule, file: "src/b.ts", line: 1 }), answer: { value: 0.9, confidence: null, kind: "noul" } },
    { subject: subjectOf({ rule, file: "src/c.ts", line: 1 }), answer: { value: 0.1, confidence: null, kind: "noul" } },
  ]);
  assert.deepEqual(g.stats.byRule, { r: 2, s: 1 });
  assert.deepEqual(g.stats.byFile, { "src/a.ts": { findings: 2, subjects: 3 }, "src/b.ts": { findings: 1, subjects: 1 }, "src/c.ts": { findings: 0, subjects: 1 } });
  const plain = formatPretty(g, { color: false });
  assert.doesNotMatch(plain, /by rule/);
  const summary = formatPretty(g, { color: false, summary: true });
  assert.match(summary, /by rule: {2}r 2 · s 1/);
  assert.match(summary, /by file: {2}src\/b\.ts 1\/1 · src\/a\.ts 2\/3/, "densest first, findings over subjects, files with none left out");
  assert.doesNotMatch(summary, /src\/c\.ts/);
});

test("gate: low confidence changes the message and never suppresses the finding", () => {
  // Gating on confidence was measured costing recall for nothing, because clean
  // and broken code occupy the same confidence band.
  const rule = scoreRule({ at: 2 });
  const f = decide(subjectOf({ rule }), { value: 2.5, confidence: 0.2, kind: "score" });
  assert.equal(f.reported, true, "a low-confidence finding is still a finding");
  assert.equal(f.messageId, "unsure");
  assert.match(describeFinding(f), /not sure/);
});

test("gate: a per-rule unsureBelow overrides the run-wide one", () => {
  // Both directions, because one of them does not distinguish "overrides" from
  // "whichever is higher wins" -- which is what jev-lint flagged the one-case
  // version for. A per-rule value BELOW the run-wide one has to win too.
  const raised = scoreRule({ at: 2, unsureBelow: 0.9 });
  const asUnsure = decide(
    subjectOf({ rule: raised }),
    { value: 2.5, confidence: 0.8, kind: "score" },
    { unsureBelow: 0.1 },
  );
  assert.equal(asUnsure.messageId, "unsure", "0.8 is below the rule's 0.9");

  const lowered = scoreRule({ at: 2, unsureBelow: 0.1 });
  const asViolation = decide(
    subjectOf({ rule: lowered }),
    { value: 2.5, confidence: 0.8, kind: "score" },
    { unsureBelow: 0.9 },
  );
  assert.equal(asViolation.messageId, "violation", "0.8 is above the rule's 0.1, so the run-wide 0.9 must not apply");
});

test("gate: a noul fires on its own cutoff and has no unsure variant", () => {
  const rule = noulRule({ at: 0.7 });
  const under = decide(subjectOf({ rule }), { value: 0.69, confidence: null, kind: "noul" });
  assert.equal(under.reported, false);
  const over = decide(subjectOf({ rule }), { value: 0.71, confidence: null, kind: "noul" });
  assert.equal(over.messageId, "flag");
});

test("gate: --loose reports the band under the cutoff for a reader, and never as a finding", () => {
  // A subject between the loose floor and the cutoff is a candidate for a
  // reader, not a finding: it does not count, does not turn the exit code,
  // and is listed apart. The floor is the rule's `loose:`, else half its
  // cutoff -- measured on the shipped evals, no defect a rule can see sits
  // under half its cutoff, and about one clean subject in twenty sits over.
  const rule = noulRule({ at: 0.6 });
  assert.equal(looseFloor(rule), 0.3);
  assert.equal(looseFloor(noulRule({ at: 0.6, loose: 0.45 })), 0.45, "a declared floor wins");
  assert.equal(looseFloor(rule, { n: 0.8 }), 0.4, "and follows an overridden cutoff");

  const at = (v: number, loose: number | null) =>
    decide(subjectOf({ rule }), { value: v, confidence: null, kind: "noul" }, { loose });
  assert.equal(at(0.45, null).messageId, null, "without --loose nothing changes");
  assert.equal(at(0.45, Infinity).messageId, "review");
  assert.equal(at(0.45, Infinity).reported, false, "a review candidate is not a finding");
  assert.equal(at(0.29, Infinity).messageId, null, "under the floor is clean");
  assert.equal(at(0.61, Infinity).messageId, "flag", "over the cutoff is what it always was");
  assert.match(describeFinding(at(0.45, Infinity)), /under its cutoff/);

  // In a run they come back apart, ranked by how close to the cutoff, capped.
  const results = [0.35, 0.55, 0.45, 0.7, 0.1].map((v, i) => ({
    subject: subjectOf({ rule, line: i + 1, endLine: i + 1 }),
    answer: { value: v, confidence: null, kind: "noul" as const },
  }));
  const loose = gate(results, { loose: 2 });
  assert.equal(loose.findings.length, 1, "the 0.7 is the only finding");
  assert.deepEqual(loose.review.map((f) => f.value), [0.55, 0.45], "two of the three in the band, closest first");
  assert.equal(loose.stats.review, 2);
  assert.equal(loose.stats.reported, 1, "the count CI reads is untouched");
  assert.ok(!blocks(loose.review, null), "and they never block");
  const tight = gate(results, {});
  assert.deepEqual(tight.review, []);
  assert.equal(tight.stats.review, 0);
});

test("gate: cutoffs are per rule and an override wins over the rule's own", () => {
  const r = noulRule({ at: 0.7 });
  assert.equal(cutoffFor(r), 0.7);
  assert.equal(cutoffFor(r, { n: 0.3 }), 0.3);
  assert.equal(cutoffFor(r, { other: 0.3 }), 0.7);
});

test("gate: a missing answer is recorded, not scored as clean", () => {
  const f = decide(subjectOf(), null);
  assert.equal(f.messageId, "missing");
  assert.equal(f.reported, false);
  assert.equal(f.value, null);
  const g = gate([{ subject: subjectOf(), answer: null }]);
  assert.equal(g.stats.missing, 1);
  assert.equal(g.stats.reported, 0);
  assert.match(describeFinding(f), /no verdict/);
});

test("gate: findings rank by distance past their own cutoff, not by raw value", () => {
  // Raw values from different rules are not comparable; margins are.
  const loose = noulRule({ id: "loose", at: 0.2 });
  const tight = scoreRule({ id: "tight", at: 2 });
  const g = gate([
    { subject: subjectOf({ rule: tight }), answer: { value: 2.2, confidence: 0.9, kind: "score" } },
    { subject: subjectOf({ rule: loose }), answer: { value: 0.9, confidence: null, kind: "noul" } },
  ]);
  assert.equal(g.findings[0].rule, "loose", "0.9/0.2 outranks 2.2/2.0");
});

test("gate: --fail-on decides which findings turn the exit code, and none is a valid answer", () => {
  const at = (severity: string) => ({ severity }) as unknown as Finding;
  const findings = [at("hint"), at("info"), at("warning")];
  assert.equal(blocks(findings, null), true, "by default any finding blocks");
  assert.equal(blocks(findings, "warning"), true);
  assert.equal(blocks(findings, "error"), false, "a pre-commit hook can ask to block on `error` only");
  assert.equal(blocks([...findings, at("error")], "error"), true);
  assert.equal(blocks([], null), false);
});
