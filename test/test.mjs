#!/usr/bin/env node
/**
 * The test suite. No API key, no network, no ast-grep binary required except
 * where a test says so.
 *
 * What gets tested here is chosen deliberately. The model's accuracy is
 * measured by `jevlint calibrate` against a labeled corpus, not asserted here --
 * a probabilistic answer has no expected value to assert. What IS asserted is
 * everything around it, and above all the FAILURE PATHS: a review tool that can
 * break a build is worse than no review tool, so every way this can fail has to
 * land on "no verdict" rather than on an exception.
 */
import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  normalizeRule,
  loadRules,
  cutoffFor,
  ruleTextHash,
  normalizeLanguage,
  SCORE_LEVELS,
  DEFAULT_SCORE_AT,
} from "../src/rules.mjs";
import { buildQuestion, questionId, readAnswer } from "../src/questions.mjs";
import { buildState, resolveSubject, renderOutline, capturedMetavariables } from "../src/state.mjs";
import { planBatches, estimateTokens, MAX_REQUEST_TOKENS, DEFAULT_BATCH_SIZE } from "../src/batch.mjs";
import { decide, gate, describe as describeFinding } from "../src/gate.mjs";
import { Cache, verdictKey } from "../src/cache.mjs";
import { parseUnifiedDiff, touchesChange } from "../src/diff.mjs";
import { widestGap, gapReport, fitCutoffs, labelFor, stabilityReport } from "../src/calibrate.mjs";
import {
  buildSymbols,
  enclosingSymbol,
  moduleIdentity,
  emitRuleFile,
  astGrepRuleId,
  baseRuleId,
  toAstGrepRule,
} from "../src/scan.mjs";
import { formatGithub, formatJson, formatPretty, silentRules } from "../src/report.mjs";
import { Jev, JevError } from "../src/jev.mjs";

let passed = 0;
let failed = 0;
const only = process.argv[2] ?? null;

function test(name, fn) {
  if (only && !name.includes(only)) return;
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    process.stdout.write(`FAIL  ${name}\n      ${err.message.split("\n").join("\n      ")}\n`);
  }
}

async function testAsync(name, fn) {
  if (only && !name.includes(only)) return;
  try {
    await fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    process.stdout.write(`FAIL  ${name}\n      ${err.message.split("\n").join("\n      ")}\n`);
  }
}

const scoreRule = (over = {}) => {
  const { rule, error } = normalizeRule({
    id: "r",
    language: "TypeScript",
    rule: { pattern: "fetch($$$)" },
    ask: "fetch must be given a timeout",
    ...over,
  });
  assert.equal(error, undefined, `fixture rule invalid: ${error}`);
  return rule;
};

const noulRule = (over = {}) =>
  normalizeRule({
    id: "n",
    language: "Rust",
    kind: "noul",
    rule: { kind: "function_item" },
    ask: "this function hides a failure",
    criteria: { true: "it does", false: "it does not" },
    ...over,
  }).rule;

const subjectOf = (over = {}) => ({
  rule: scoreRule(),
  file: "a.ts",
  line: 3,
  endLine: 5,
  text: "fetch(url)",
  nodeKind: "call_expression",
  arm: "located",
  language: "TypeScript",
  captured: {},
  ...over,
});

// ---------------------------------------------------------------- rules

test("rules: a minimal score rule is valid and defaults are the documented ones", () => {
  const r = scoreRule();
  assert.equal(r.kind, "score");
  assert.equal(r.subject, "node");
  assert.equal(r.state, "located");
  assert.equal(r.severity, "warning");
  assert.equal(cutoffFor(r), DEFAULT_SCORE_AT);
  assert.deepEqual(r.languages, ["TypeScript"]);
});

test("rules: a missing ask, rule, id or language is an error, not a silent drop", () => {
  for (const [field, patch] of [
    ["ask", { ask: "  " }],
    ["rule", { rule: undefined }],
    ["id", { id: "" }],
    ["language", { language: "Klingon" }],
  ]) {
    const { rule, error } = normalizeRule({
      id: "x",
      language: "TypeScript",
      rule: { kind: "x" },
      ask: "a",
      ...patch,
    });
    assert.equal(rule, undefined, `expected ${field} to be rejected`);
    assert.ok(error, `expected an error message for ${field}`);
  }
});

test("rules: a noul without nested criteria is rejected before it can reach the wire", () => {
  // The server accepts a flat {true,false} with a 200 and silently discards the
  // criteria. Rejecting the shape here is the only place it can be caught.
  const flat = normalizeRule({
    id: "n",
    language: "Rust",
    kind: "noul",
    rule: { kind: "function_item" },
    ask: "a",
    true: "yes",
    false: "no",
  });
  assert.ok(flat.error, "a noul with top-level true/false must be rejected");
  assert.match(flat.error, /criteria/);

  const missingFalse = normalizeRule({
    id: "n",
    language: "Rust",
    kind: "noul",
    rule: { kind: "function_item" },
    ask: "a",
    criteria: { true: "yes" },
  });
  assert.ok(missingFalse.error);
});

test("rules: criteria on a score rule is rejected (it uses the shared scale)", () => {
  const { error } = normalizeRule({
    id: "s",
    language: "TypeScript",
    rule: { kind: "x" },
    ask: "a",
    criteria: { true: "y", false: "n" },
  });
  assert.ok(error);
});

test("rules: an out-of-range or mistyped cutoff is rejected per kind", () => {
  assert.ok(normalizeRule({ id: "s", language: "TypeScript", rule: {}, ask: "a", at: 4 }).error);
  assert.ok(
    normalizeRule({
      id: "n",
      language: "Rust",
      kind: "noul",
      rule: {},
      ask: "a",
      criteria: { true: "y", false: "n" },
      at: 2,
    }).error,
    "a noul cutoff above 1 must be rejected",
  );
  assert.ok(normalizeRule({ id: "s", language: "TypeScript", rule: {}, ask: "a", at: "2" }).error);
});

test("rules: an unknown field is an error, so a typo cannot silently do nothing", () => {
  const { error } = normalizeRule({
    id: "s",
    language: "TypeScript",
    rule: { kind: "x" },
    ask: "a",
    reportAt: 2,
  });
  assert.ok(error);
  assert.match(error, /reportAt/);
});

test("rules: languages expands, dedupes and rejects mixing with language", () => {
  const r = normalizeRule({
    id: "s",
    languages: ["ts", "Tsx", "typescript"],
    rule: { kind: "x" },
    ask: "a",
  }).rule;
  assert.deepEqual(r.languages, ["TypeScript", "Tsx"]);
  assert.ok(
    normalizeRule({
      id: "s",
      language: "ts",
      languages: ["Tsx"],
      rule: {},
      ask: "a",
    }).error,
  );
});

test("rules: language aliases normalize, unknown ones do not", () => {
  assert.equal(normalizeLanguage("rs"), "Rust");
  assert.equal(normalizeLanguage("TYPESCRIPT"), "TypeScript");
  assert.equal(normalizeLanguage("Klingon"), null);
});

test("rules: the draft hash covers what the model sees and excludes the threshold", () => {
  const base = scoreRule();
  // Recalibrating must be free, so `at` cannot be part of the hash.
  assert.equal(ruleTextHash(base), ruleTextHash(scoreRule({ at: 2.7 })));
  assert.equal(ruleTextHash(base), ruleTextHash(scoreRule({ severity: "error" })));
  // Everything the model is shown must be.
  assert.notEqual(ruleTextHash(base), ruleTextHash(scoreRule({ ask: "different" })));
  assert.notEqual(ruleTextHash(base), ruleTextHash(scoreRule({ note: "an exception" })));
  assert.notEqual(ruleTextHash(base), ruleTextHash(scoreRule({ subject: "enclosing" })));
  assert.notEqual(ruleTextHash(base), ruleTextHash(scoreRule({ state: "bare" })));
});

test("rules: a shared YAML anchor gives two language variants the same draft hash", () => {
  const dir = mkdtempSync(join(tmpdir(), "jevlint-test-"));
  try {
    writeFileSync(
      join(dir, "p.yml"),
      [
        "- id: a",
        "  language: TypeScript",
        "  kind: noul",
        "  rule: { kind: function_declaration }",
        "  ask: &q the same sentence",
        "  criteria: &c { 'true': yes-text, 'false': no-text }",
        "- id: a-rust",
        "  language: Rust",
        "  kind: noul",
        "  rule: { kind: function_item }",
        "  ask: *q",
        "  criteria: *c",
      ].join("\n"),
    );
    const { rules, errors } = loadRules([dir]);
    assert.deepEqual(errors, []);
    assert.equal(rules.length, 2);
    assert.equal(ruleTextHash(rules[0]), ruleTextHash(rules[1]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rules: a duplicate id is reported and a missing path is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "jevlint-test-"));
  try {
    const body = "id: dup\nlanguage: TypeScript\nrule: {kind: program}\nask: a\n";
    writeFileSync(join(dir, "a.yml"), body);
    writeFileSync(join(dir, "b.yml"), body);
    const { rules, errors } = loadRules([dir, join(dir, "nope.yml")]);
    assert.equal(rules.length, 1);
    assert.ok(errors.some((e) => /duplicate/.test(e)));
    assert.ok(errors.some((e) => /no such file/.test(e)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rules: the shipped pack loads with no errors", () => {
  const { rules, errors } = loadRules(["rules"]);
  assert.deepEqual(errors, [], `shipped rules must be valid: ${errors.join("; ")}`);
  assert.ok(rules.length >= 8);
  // Every shipped rule must declare a cutoff, since the defaults are
  // placeholders rather than calibrations.
  for (const r of rules) {
    assert.equal(typeof r.at, "number", `${r.id} should ship with a fitted cutoff`);
  }
});

// ------------------------------------------------------------- questions

test("questions: a noul question nests its criteria and carries no threshold", () => {
  const q = buildQuestion(noulRule(), subjectOf(), "q0000");
  assert.equal(q.type, "noul");
  assert.deepEqual(Object.keys(q.criteria).sort(), ["false", "true"]);
  assert.equal(q.true, undefined, "criteria must not be hoisted to the top level");
  const wire = JSON.stringify(q);
  assert.ok(!/\bat\b.*0\.\d/.test(wire), "a cutoff must never appear in a question");
});

test("questions: a score question carries the shared four-level scale", () => {
  const q = buildQuestion(scoreRule(), subjectOf(), "q0000");
  assert.equal(q.type, "score");
  assert.deepEqual(q.criteria, SCORE_LEVELS);
  assert.equal(q.criteria.length, 4);
});

test("questions: the note reaches the model and never the finding text", () => {
  const rule = scoreRule({ note: "not a violation inside a retry wrapper" });
  const q = buildQuestion(rule, subjectOf(), "q0000");
  assert.equal(q.instructions.also, "not a violation inside a retry wrapper");
  const finding = decide(subjectOf({ rule }), { value: 3, confidence: 0.9, kind: "score" });
  assert.ok(!describeFinding(finding).includes("retry wrapper"));
});

test("questions: captured metavariables are handed to the question by name", () => {
  const q = buildQuestion(
    noulRule(),
    subjectOf({ captured: { NAME: "loadUser", TITLE: "rejects an empty name" } }),
    "q0000",
  );
  assert.deepEqual(q.instructions.matcher_captured, {
    NAME: "loadUser",
    TITLE: "rejects an empty name",
  });
});

test("questions: short subjects are inlined, long ones are referenced by line", () => {
  const short = buildQuestion(scoreRule(), subjectOf({ text: "fetch(u)" }), "q0000");
  assert.equal(short.instructions.code, "fetch(u)");
  const long = buildQuestion(scoreRule(), subjectOf({ text: "x".repeat(5000) }), "q0000");
  assert.equal(long.instructions.code, undefined);
  assert.equal(long.instructions.lines, "3-5");
});

test("questions: a file subject is labelled an outline, not code", () => {
  const q = buildQuestion(
    noulRule({ subject: "file" }),
    subjectOf({ isOutline: true, text: "path: a.ts" }),
    "q0000",
  );
  assert.equal(q.instructions.code, undefined);
  assert.equal(q.instructions.module_outline, "path: a.ts");
  assert.equal(q.instructions.matched_because, undefined);
});

test("questions: ids are stable and zero-padded", () => {
  assert.equal(questionId(0), "q0000");
  assert.equal(questionId(42), "q0042");
  assert.equal(questionId(1234), "q1234");
});

test("questions: unusable answers read back as null rather than as zero", () => {
  assert.equal(readAnswer({}, "q0000", "score"), null);
  assert.equal(readAnswer({ q0000: { type: "noul", noul: 0.9 } }, "q0000", "score"), null);
  assert.equal(readAnswer({ q0000: { type: "score", score: "2" } }, "q0000", "score"), null);
  assert.deepEqual(readAnswer({ q0000: { type: "noul", noul: 0.9 } }, "q0000", "noul"), {
    value: 0.9,
    confidence: null,
    kind: "noul",
  });
  // A noul has no confidence of its own; inventing one would let it be routed.
  assert.equal(
    readAnswer({ q0000: { type: "noul", noul: 0.9, confidence: 0.3 } }, "q0000", "noul").confidence,
    null,
  );
});

// ----------------------------------------------------------------- state

const sampleEntry = () => ({
  language: "TypeScript",
  imports: ['import { db } from "./db"'],
  exportRanges: [],
  symbols: [
    {
      name: "outer",
      role: "function",
      start: 0,
      end: 200,
      line: 1,
      endLine: 20,
      text: "function outer() {}",
      exported: true,
      isTest: false,
      calls: ["inner"],
      calledBy: [],
    },
    {
      name: "inner",
      role: "function",
      start: 50,
      end: 100,
      line: 5,
      endLine: 9,
      text: "function inner() {}",
      exported: false,
      isTest: false,
      calls: [],
      calledBy: ["outer"],
    },
  ],
});

test("state: each arm carries exactly the sections it promises", () => {
  const args = {
    file: "src/a.ts",
    source: "SOURCE",
    entry: sampleEntry(),
    subjects: [{ id: "q0000", ruleId: "r", nodeKind: "call", line: 3, endLine: 3 }],
    language: "TypeScript",
  };
  const bare = buildState({ ...args, arm: "bare" });
  assert.equal(bare.source, undefined);
  assert.equal(bare.symbols, undefined);
  assert.equal(bare.file, "src/a.ts", "even bare names the file, or naming cannot be judged");

  const located = buildState({ ...args, arm: "located" });
  assert.equal(located.source, "SOURCE");
  assert.equal(located.symbols, undefined);

  const graph = buildState({ ...args, arm: "graph" });
  assert.equal(graph.source, undefined, "graph is the arm that fits a large file");
  assert.ok(graph.symbols.length === 2);
  assert.equal(graph.module.stem, "a");
  assert.deepEqual(graph.imports, ['import { db } from "./db"']);

  const full = buildState({ ...args, arm: "full" });
  assert.equal(full.source, "SOURCE");
  assert.ok(full.symbols.length === 2);
});

test("state: every question appears in the subject index on every arm", () => {
  const subjects = [
    { id: "q0000", ruleId: "r", nodeKind: "call", line: 3, endLine: 3 },
    { id: "q0001", ruleId: "r2", nodeKind: "call", line: 9, endLine: 11 },
  ];
  for (const arm of ["bare", "located", "graph", "full"]) {
    const s = buildState({
      file: "a.ts",
      source: "x",
      entry: sampleEntry(),
      subjects,
      arm,
      language: "TypeScript",
    });
    assert.deepEqual(s.subjects.map((x) => x.id), ["q0000", "q0001"], `arm ${arm}`);
    assert.equal(s.subjects[1].lines, "9-11");
  }
});

test("state: the graph arm excludes symbol bodies, which is what keeps it small", () => {
  const s = buildState({
    file: "a.ts",
    source: "SOURCE",
    entry: sampleEntry(),
    subjects: [],
    arm: "graph",
    language: "TypeScript",
  });
  assert.ok(!JSON.stringify(s).includes("function outer() {}"));
  assert.deepEqual(s.symbols[0].calls, ["inner"]);
  assert.deepEqual(s.symbols[1].called_by, ["outer"]);
  assert.equal(s.symbols[0].exported, true);
});

const matchAt = (start, end, over = {}) => ({
  file: "a.ts",
  text: "fetch(u)",
  language: "TypeScript",
  range: {
    byteOffset: { start, end },
    start: { line: 5, column: 2 },
    end: { line: 5, column: 10 },
  },
  ...over,
});

test("state: subject node reports the match and names its container", () => {
  const s = resolveSubject(matchAt(60, 70), scoreRule(), sampleEntry());
  assert.equal(s.text, "fetch(u)");
  assert.equal(s.line, 6);
  assert.deepEqual(s.enclosing, { name: "inner", role: "function" });
  assert.equal(s.promoted, false);
});

test("state: subject enclosing promotes to the narrowest container", () => {
  const s = resolveSubject(matchAt(60, 70), scoreRule({ subject: "enclosing" }), sampleEntry());
  assert.equal(s.text, "function inner() {}");
  assert.equal(s.line, 5);
  assert.equal(s.promoted, true);
});

test("state: subject enclosing falls back to the node rather than dropping it", () => {
  // Dropping would make the matcher fail silently a second way.
  const s = resolveSubject(
    matchAt(500, 510),
    scoreRule({ subject: "enclosing" }),
    sampleEntry(),
  );
  assert.equal(s.text, "fetch(u)");
  assert.equal(s.promoted, false);
});

test("state: a symbol is not its own container", () => {
  const entry = sampleEntry();
  const s = resolveSubject(
    matchAt(50, 100, { text: "function inner() {}" }),
    scoreRule({ subject: "enclosing" }),
    entry,
  );
  assert.equal(s.text, "function outer() {}", "inner must promote to outer, not to itself");
});

test("state: enclosingSymbol picks the narrowest and returns null outside", () => {
  const e = sampleEntry();
  assert.equal(enclosingSymbol(e, 60, 70).name, "inner");
  assert.equal(enclosingSymbol(e, 10, 20).name, "outer");
  assert.equal(enclosingSymbol(e, 900, 950), null);
  assert.equal(enclosingSymbol(null, 1, 2), null);
});

test("state: the module outline carries path, visibility split and imports", () => {
  const out = renderOutline("src/api/user.ts", sampleEntry());
  assert.match(out, /path: src\/api\/user\.ts/);
  assert.match(out, /public API:[\s\S]*outer/);
  assert.match(out, /private to this module:[\s\S]*inner/);
  assert.match(out, /imports:/);
});

test("state: a module with no named items says so rather than rendering nothing", () => {
  const out = renderOutline("src/empty.ts", { symbols: [], imports: [] });
  assert.match(out, /declares no named items/);
});

test("state: moduleIdentity resolves conventional entry points to their directory", () => {
  assert.equal(moduleIdentity("src/api/mod.rs").named_by_directory, "api");
  assert.equal(moduleIdentity("src/api/index.ts").named_by_directory, "api");
  assert.equal(moduleIdentity("src/api/user.ts").named_by_directory, null);
  assert.equal(moduleIdentity("src/api/user.ts").stem, "user");
});

test("state: reserved captures are hidden and long ones truncated", () => {
  const c = capturedMetavariables({
    metaVariables: {
      single: {
        JEVNAME: { text: "probe-only" },
        NAME: { text: "loadUser" },
        BIG: { text: "y".repeat(2000) },
      },
      multi: { ARGS: [{ text: "a" }, { text: "b" }] },
    },
  });
  assert.equal(c.JEVNAME, undefined);
  assert.equal(c.NAME, "loadUser");
  assert.ok(c.BIG.length <= 601);
  assert.equal(c.ARGS, "a, b");
});

// ----------------------------------------------------------------- batch

const manySubjects = (n, over = {}) =>
  Array.from({ length: n }, (_, i) =>
    subjectOf({ line: i + 1, endLine: i + 1, text: `call${i}()`, ...over }),
  );

test("batch: every subject lands in exactly one batch and none is empty", () => {
  const subjects = manySubjects(700);
  const batches = planBatches(subjects, {
    sources: new Map([["a.ts", "source"]]),
    symbols: new Map([["a.ts", sampleEntry()]]),
  });
  const total = batches.reduce((a, b) => a + b.subjects.length, 0);
  assert.equal(total, 700);
  assert.ok(batches.every((b) => b.subjects.length > 0));
  assert.ok(batches.every((b) => b.subjects.length <= DEFAULT_BATCH_SIZE));
});

test("batch: no batch exceeds the request ceiling", () => {
  const subjects = manySubjects(400, { text: "x".repeat(800) });
  const batches = planBatches(subjects, {
    sources: new Map([["a.ts", "source"]]),
    symbols: new Map(),
  });
  // This guard is the point of the assertion below. Without it, a planner that
  // returned one subject per batch would satisfy the loop vacuously and this
  // test would pass while verifying nothing about the ceiling.
  //
  // This weakness was found by running jevlint on its own test suite:
  // `test-name-matches-body` scored the original 0.68-0.73 across runs against
  // a 0.69 cutoff, for precisely this reason. The model was right.
  const multi = batches.filter((b) => b.subjects.length > 1);
  assert.ok(multi.length > 0, "the planner must actually group subjects for this to test anything");
  for (const b of multi) {
    assert.ok(
      b.estimatedTokens <= MAX_REQUEST_TOKENS,
      `batch of ${b.subjects.length} estimated ${b.estimatedTokens}`,
    );
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
  const b = batches[0];
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
  assert.equal(batches[0].degraded.from, "located");
  // A step-down is a real loss of context, so it must be visible.
  assert.match(batches[0].degraded.reason, /state budget/);
});

test("batch: the token estimate is pessimistic rather than optimistic", () => {
  // The estimator must not under-count, or a batch sails past the ceiling and
  // costs a round trip to find out.
  const text = "a".repeat(3400);
  assert.ok(estimateTokens(text) >= 1000);
  assert.equal(estimateTokens(""), 0);
  assert.ok(estimateTokens({ a: "b" }) > 0);
});

// ------------------------------------------------------------------ gate

test("gate: score findings fire at the cutoff and are named by level", () => {
  const rule = scoreRule({ at: 2 });
  const below = decide(subjectOf({ rule }), { value: 1.99, confidence: 0.9, kind: "score" });
  assert.equal(below.reported, false);
  const at = decide(subjectOf({ rule }), { value: 2.0, confidence: 0.9, kind: "score" });
  assert.equal(at.reported, true);
  assert.equal(at.messageId, "violation");
  assert.equal(at.level, "arguable");
  const high = decide(subjectOf({ rule }), { value: 2.9, confidence: 0.9, kind: "score" });
  assert.equal(high.level, "violation");
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
  const rule = scoreRule({ at: 2, unsureBelow: 0.9 });
  const f = decide(subjectOf({ rule }), { value: 2.5, confidence: 0.8, kind: "score" }, { unsureBelow: 0.1 });
  assert.equal(f.messageId, "unsure");
});

test("gate: a noul fires on its own cutoff and has no unsure variant", () => {
  const rule = noulRule({ at: 0.7 });
  const under = decide(subjectOf({ rule }), { value: 0.69, confidence: null, kind: "noul" });
  assert.equal(under.reported, false);
  const over = decide(subjectOf({ rule }), { value: 0.71, confidence: null, kind: "noul" });
  assert.equal(over.messageId, "flag");
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

// ----------------------------------------------------------------- cache

test("cache: a key covers the draft and the arm but not the threshold", () => {
  const r = scoreRule();
  const k = verdictKey(r, "located", "TEXT");
  assert.equal(k, verdictKey(scoreRule({ at: 2.9 }), "located", "TEXT"));
  assert.notEqual(k, verdictKey(scoreRule({ ask: "other" }), "located", "TEXT"));
  assert.notEqual(k, verdictKey(r, "bare", "TEXT"));
  assert.notEqual(k, verdictKey(r, "located", "OTHER"));
});

test("cache: a missing, unreadable, malformed or stale file means no verdict, never a throw", () => {
  const dir = mkdtempSync(join(tmpdir(), "jevlint-test-"));
  try {
    const missing = Cache.load(join(dir, "nope.json"));
    assert.equal(missing.get("k", "score"), null);

    writeFileSync(join(dir, "bad.json"), "{not json");
    const bad = Cache.load(join(dir, "bad.json"));
    assert.equal(bad.get("k", "score"), null);
    assert.ok(bad.loadError);

    writeFileSync(join(dir, "old.json"), JSON.stringify({ schema: "ancient", entries: { k: { value: 3 } } }));
    const old = Cache.load(join(dir, "old.json"));
    assert.equal(old.get("k", "score"), null);
    assert.ok(old.loadError);

    // A directory is unreadable as a file.
    mkdirSync(join(dir, "adir"));
    assert.equal(Cache.load(join(dir, "adir")).get("k", "score"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cache: an entry of the wrong kind is a miss, not a wrong answer", () => {
  const c = new Cache(null);
  c.set("k", { value: 0.8, confidence: null, kind: "noul" });
  assert.equal(c.get("k", "score"), null);
  assert.deepEqual(c.get("k", "noul"), { value: 0.8, confidence: null, kind: "noul" });
});

test("cache: a round trip through disk preserves verdicts, and prune drops orphans", () => {
  const dir = mkdtempSync(join(tmpdir(), "jevlint-test-"));
  try {
    const path = join(dir, "c.json");
    const c = new Cache(path);
    c.set("keep", { value: 2.5, confidence: 0.7, kind: "score" }, { rule: "r" });
    c.set("drop", { value: 1.0, confidence: 0.4, kind: "score" }, { rule: "r" });
    assert.equal(c.save({ model: "jev-test" }), true);

    const back = Cache.load(path);
    assert.equal(back.loadError, null);
    assert.deepEqual(back.get("keep", "score"), { value: 2.5, confidence: 0.7, kind: "score" });
    assert.equal(back.prune(["keep"]), 1);
    assert.equal(back.entries.size, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cache: a non-numeric verdict is never stored", () => {
  const c = new Cache(null);
  c.set("k", { value: "2", kind: "score" });
  c.set("k2", null);
  assert.equal(c.entries.size, 0);
});

// ------------------------------------------------------------------ diff

test("diff: hunk headers become post-image line ranges", () => {
  const ranges = parseUnifiedDiff(
    [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,0 +1,3 @@",
      "@@ -20,2 +23 @@",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -5,3 +5,2 @@",
    ].join("\n"),
  );
  assert.deepEqual(ranges.get("src/a.ts"), [
    [1, 3],
    [23, 23],
  ]);
  assert.deepEqual(ranges.get("src/b.ts"), [[5, 6]]);
});

test("diff: a pure deletion contributes no reviewable range", () => {
  const ranges = parseUnifiedDiff(
    ["--- a/x.ts", "+++ b/x.ts", "@@ -4,3 +3,0 @@"].join("\n"),
  );
  assert.equal(ranges.get("x.ts"), undefined);
});

test("diff: a deleted file is skipped entirely", () => {
  const ranges = parseUnifiedDiff(
    ["--- a/gone.ts", "+++ /dev/null", "@@ -1,5 +0,0 @@"].join("\n"),
  );
  assert.equal(ranges.size, 0);
});

test("diff: adjacent hunks merge so a subject is not tested twice", () => {
  const ranges = parseUnifiedDiff(
    ["--- a/x.ts", "+++ b/x.ts", "@@ -1 +1,2 @@", "@@ -5 +3,2 @@"].join("\n"),
  );
  assert.deepEqual(ranges.get("x.ts"), [[1, 4]]);
});

test("diff: overlap is inclusive at both ends and false for unknown files", () => {
  const ranges = new Map([["a.ts", [[10, 20]]]]);
  assert.equal(touchesChange(ranges, "a.ts", 1, 10), true, "ends touching counts");
  assert.equal(touchesChange(ranges, "a.ts", 20, 30), true);
  assert.equal(touchesChange(ranges, "a.ts", 5, 9), false);
  assert.equal(touchesChange(ranges, "a.ts", 21, 30), false);
  assert.equal(touchesChange(ranges, "a.ts", 12, 15), true, "fully inside counts");
  assert.equal(touchesChange(ranges, "other.ts", 12, 15), false);
});

// ------------------------------------------------------------- calibrate

test("calibrate: widestGap finds the largest step and where it sits", () => {
  const g = widestGap([0.1, 0.15, 0.9, 0.95]);
  assert.ok(Math.abs(g.gap - 0.75) < 1e-9);
  assert.ok(Math.abs(g.low - 0.15) < 1e-9);
  assert.ok(Math.abs(g.high - 0.9) < 1e-9);
  assert.equal(widestGap([]).gap, 0);
  assert.equal(widestGap([0.5]).gap, 0);
});

test("calibrate: a wide gap with the cutoff inside it reads `works`", () => {
  const rule = noulRule({ at: 0.5 });
  const all = [0.05, 0.1, 0.12, 0.9, 0.93].map((value, i) => ({
    rule: "n",
    file: "a.rs",
    line: i,
    value,
  }));
  const row = gapReport(all, [rule])[0];
  assert.equal(row.verdict, "works");
  assert.equal(row.inGap, true);
  assert.equal(row.reported, 2);
});

test("calibrate: a wide gap with the cutoff outside it reads `move` and suggests the midpoint", () => {
  const rule = noulRule({ at: 0.95 });
  const all = [0.05, 0.1, 0.12, 0.8, 0.82].map((value, i) => ({
    rule: "n",
    file: "a.rs",
    line: i,
    value,
  }));
  const row = gapReport(all, [rule])[0];
  assert.equal(row.verdict, "move");
  assert.ok(Math.abs(row.suggested - 0.46) < 0.02);
});

test("calibrate: bunched answers read `rewrite`, because no cutoff can fix them", () => {
  const rule = noulRule({ at: 0.5 });
  const all = [0.41, 0.45, 0.48, 0.52, 0.55].map((value, i) => ({
    rule: "n",
    file: "a.rs",
    line: i,
    value,
  }));
  assert.equal(gapReport(all, [rule])[0].verdict, "rewrite");
});

test("calibrate: a matcher that never fired reads `silent`, not clean", () => {
  const row = gapReport([], [noulRule()])[0];
  assert.equal(row.verdict, "silent");
  assert.equal(row.matches, 0);
});

test("calibrate: `wide` is judged relative to the scale, not absolutely", () => {
  // 0.4 is narrow on a 0-3 score and wide on a 0-1 noul.
  const values = [0.1, 0.12, 0.15, 0.55, 0.58];
  const asNoul = gapReport(
    values.map((value, i) => ({ rule: "n", file: "a", line: i, value })),
    [noulRule({ at: 0.3 })],
  )[0];
  const asScore = gapReport(
    values.map((value, i) => ({ rule: "r", file: "a", line: i, value })),
    [scoreRule({ at: 0.3 })],
  )[0];
  assert.equal(asNoul.verdict, "works");
  assert.equal(asScore.verdict, "rewrite");
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
  const labels = {
    $default: "clean",
    "a.rs": [{ line: 3, label: "bad", rule: "n", window: 0 }],
  };
  const fit = fitCutoffs(all, labels, [rule])[0];
  assert.equal(fit.separable, true);
  assert.ok(Math.abs(fit.fitted - 0.55) < 0.01, `expected the midpoint, got ${fit.fitted}`);
  assert.equal(fit.precision, 1);
  assert.equal(fit.recall, 1);
});

test("calibrate: an overlapping corpus reports no separating cutoff rather than pretending", () => {
  const rule = noulRule({ id: "n" });
  const all = [
    { rule: "n", file: "a.rs", line: 1, value: 0.8 },
    { rule: "n", file: "a.rs", line: 2, value: 0.3 },
  ];
  const labels = {
    $default: "clean",
    "a.rs": [{ line: 2, label: "bad", rule: "n", window: 0 }],
  };
  const fit = fitCutoffs(all, labels, [rule])[0];
  assert.equal(fit.separable, false);
  assert.match(fit.reason, /no separating cutoff/);
});

test("calibrate: a rule with no labeled violations reports why, not a number", () => {
  const fit = fitCutoffs(
    [{ rule: "n", file: "a.rs", line: 1, value: 0.2 }],
    { $default: "clean" },
    [noulRule({ id: "n" })],
  )[0];
  assert.equal(fit.fitted, null);
  assert.match(fit.reason, /no labeled violations/);
});

test("calibrate: labels match within a window, respect the rule, and default", () => {
  const labels = {
    $default: "clean",
    "a.ts": [
      { line: 10, label: "bad", rule: "r1", window: 2 },
      { line: 40, label: "clean", window: 2 },
    ],
  };
  assert.equal(labelFor(labels, "a.ts", 11, "r1"), "bad");
  assert.equal(labelFor(labels, "a.ts", 13, "r1"), "clean", "outside the window");
  assert.equal(labelFor(labels, "a.ts", 10, "r2"), "clean", "another rule's label");
  assert.equal(labelFor(labels, "b.ts", 1, "r1"), "clean", "unlisted file takes the default");
  assert.equal(labelFor({}, "b.ts", 1, "r1"), "unlabeled", "no default means unlabeled");
});

test("calibrate: stability reports a flip only when the decision changes", () => {
  const rule = noulRule({ id: "n", at: 0.5 });
  const mk = (value) => [{ rule: "n", file: "a.rs", line: 1, value }];
  const stable = stabilityReport([mk(0.9), mk(0.95), mk(0.88)], [rule]);
  assert.equal(stable.flipped.length, 0);
  assert.ok(stable.subjects[0].spread > 0, "a wobble away from the cutoff is not a flip");

  const flipping = stabilityReport([mk(0.49), mk(0.51)], [rule]);
  assert.equal(flipping.flipped.length, 1);
  assert.equal(flipping.rows[0].flipped, 1);
});

// ------------------------------------------------------------------ scan

test("scan: emitted rules are valid ast-grep rules with jevlint fields stripped", () => {
  const r = scoreRule({ at: 2, note: "x" });
  const emitted = toAstGrepRule(r, "TypeScript");
  assert.deepEqual(Object.keys(emitted).sort(), ["id", "language", "message", "rule", "severity"]);
  assert.equal(emitted.ask, undefined);
  assert.equal(emitted.at, undefined);
  assert.equal(emitted.note, undefined);
});

test("scan: a multi-language rule emits one ast-grep rule per grammar", () => {
  const r = normalizeRule({
    id: "m",
    languages: ["TypeScript", "Tsx"],
    rule: { kind: "program" },
    ask: "a",
  }).rule;
  const text = emitRuleFile([r], ["TypeScript", "Tsx"]);
  assert.match(text, /id: m@TypeScript/);
  assert.match(text, /id: m@Tsx/);
});

test("scan: a per-grammar id round-trips back to the rule that owns the sentence", () => {
  assert.equal(baseRuleId(astGrepRuleId("my-rule", "Rust")), "my-rule");
  assert.equal(baseRuleId(astGrepRuleId("has@at", "Tsx")), "has@at");
  assert.equal(baseRuleId("no-suffix"), "no-suffix");
});

test("scan: constraints and utils pass through untouched", () => {
  const r = normalizeRule({
    id: "c",
    language: "TypeScript",
    rule: { pattern: "$A.foo()" },
    constraints: { A: { regex: "^this$" } },
    utils: { helper: { kind: "identifier" } },
    ask: "a",
  }).rule;
  const emitted = toAstGrepRule(r, "TypeScript");
  assert.deepEqual(emitted.constraints, { A: { regex: "^this$" } });
  assert.deepEqual(emitted.utils, { helper: { kind: "identifier" } });
});

test("scan: symbols come out nested, visibility resolved, with call edges", () => {
  const probes = [
    // Two containers and an export wrapper, as the probes would report them.
    {
      ruleId: "__jevlint_c0_TypeScript",
      file: "a.ts",
      language: "TypeScript",
      text: "function outer() { return inner(); }",
      range: { byteOffset: { start: 7, end: 60 }, start: { line: 0 }, end: { line: 4 } },
      metaVariables: { single: { JEVNAME: { text: "outer" } } },
    },
    {
      ruleId: "__jevlint_c0_TypeScript",
      file: "a.ts",
      language: "TypeScript",
      text: "function inner() { return 1; }",
      range: { byteOffset: { start: 70, end: 100 }, start: { line: 6 }, end: { line: 8 } },
      metaVariables: { single: { JEVNAME: { text: "inner" } } },
    },
    {
      ruleId: "__jevlint_e0_TypeScript",
      file: "a.ts",
      language: "TypeScript",
      text: "export function outer() {}",
      range: { byteOffset: { start: 0, end: 60 }, start: { line: 0 }, end: { line: 4 } },
    },
    {
      ruleId: "__jevlint_i0_TypeScript",
      file: "a.ts",
      language: "TypeScript",
      text: 'import { db } from "./db";',
      range: { byteOffset: { start: 200, end: 226 }, start: { line: 10 }, end: { line: 10 } },
    },
  ];
  const syms = buildSymbols(probes, ["TypeScript"]);
  const entry = syms.get("a.ts");
  const outer = entry.symbols.find((s) => s.name === "outer");
  const inner = entry.symbols.find((s) => s.name === "inner");
  assert.equal(outer.exported, true, "containment in an export_statement resolves visibility");
  assert.equal(inner.exported, false);
  assert.deepEqual(outer.calls, ["inner"]);
  assert.deepEqual(inner.calledBy, ["outer"]);
  assert.deepEqual(entry.imports, ['import { db } from "./db";']);
});

test("scan: two symbols sharing a name do not form a call edge with each other", () => {
  // Rust's `struct Cache` and `impl Cache` share one name.
  const mk = (role, start, end) => ({
    ruleId: role === "struct" ? "__jevlint_c2_Rust" : "__jevlint_c1_Rust",
    file: "a.rs",
    language: "Rust",
    text: role === "struct" ? "pub struct Cache { }" : "impl Cache { }",
    range: { byteOffset: { start, end }, start: { line: 0 }, end: { line: 1 } },
    metaVariables: { single: { JEVNAME: { text: "Cache" } } },
  });
  const syms = buildSymbols([mk("struct", 0, 20), mk("impl", 30, 60)], ["Rust"]);
  for (const s of syms.get("a.rs").symbols) {
    assert.deepEqual(s.calls, [], `${s.role} must not call itself by name`);
  }
});

test("scan: every symbol has call arrays, including ones excluded from the graph", () => {
  const probes = [
    {
      ruleId: "__jevlint_c5_Rust",
      file: "a.rs",
      language: "Rust",
      text: "mod tests { }",
      range: { byteOffset: { start: 0, end: 13 }, start: { line: 0 }, end: { line: 0 } },
      metaVariables: { single: { JEVNAME: { text: "tests" } } },
    },
  ];
  const entry = buildSymbols(probes, ["Rust"]).get("a.rs");
  assert.deepEqual(entry.symbols[0].calls, []);
  assert.deepEqual(entry.symbols[0].calledBy, []);
});

test("scan: Rust visibility and test markers come from the item's own text", () => {
  const mk = (text) => ({
    ruleId: "__jevlint_c0_Rust",
    file: "a.rs",
    language: "Rust",
    text,
    range: { byteOffset: { start: 0, end: text.length }, start: { line: 0 }, end: { line: 0 } },
    metaVariables: { single: { JEVNAME: { text: "f" } } },
  });
  const pub = buildSymbols([mk("pub fn f() {}")], ["Rust"]).get("a.rs").symbols[0];
  const priv = buildSymbols([mk("fn f() {}")], ["Rust"]).get("a.rs").symbols[0];
  const test_ = buildSymbols([mk("#[cfg(test)] mod f {}")], ["Rust"]).get("a.rs").symbols[0];
  assert.equal(pub.exported, true);
  assert.equal(priv.exported, false);
  assert.equal(test_.isTest, true);
});

// ---------------------------------------------------------------- report

test("report: rules that produced no subject are listed", () => {
  const fired = scoreRule({ id: "fired" });
  const quiet = scoreRule({ id: "quiet" });
  const result = { rules: [fired, quiet], subjects: [{ rule: fired }] };
  assert.deepEqual(silentRules(result), ["quiet"]);
});

test("report: github annotations escape newlines and never use error by default", () => {
  const rule = scoreRule({ at: 2 });
  const g = gate([
    {
      subject: subjectOf({ rule }),
      answer: { value: 2.9, confidence: 0.9, kind: "score" },
    },
  ]);
  const text = formatGithub({ ...g, rules: [rule] });
  assert.match(text, /^::warning file=a\.ts,line=3,endLine=5/);
  assert.ok(!text.includes("\n::error"));

  const multiline = formatGithub({
    ...gate([
      {
        subject: subjectOf({ rule: scoreRule({ at: 2, message: "line one\nline two" }) }),
        answer: { value: 2.9, confidence: 0.9, kind: "score" },
      },
    ]),
    rules: [],
  });
  assert.ok(!multiline.slice(2).includes("\n"), "a message newline must be escaped");
  assert.match(multiline, /%0A/);
});

test("report: an incomplete run says so in every format", () => {
  const g = gate([{ subject: subjectOf(), answer: null }]);
  const result = { ...g, rules: [], subjects: [], spent: {}, elapsedMs: 1 };
  assert.match(formatGithub(result), /this run is incomplete/);
  assert.equal(JSON.parse(formatJson(result)).stats.missing, 1);
  // The third format. This assertion was missing, and jevlint's own
  // `test-name-matches-body` flagged the title's "every format" against a body
  // that checked two of three (0.64 against a 0.69 cutoff -- under it, but for
  // a correct reason).
  assert.match(
    formatPretty(result, { color: false, showMissing: true }),
    /without a verdict|no verdict/,
  );
});

test("report: severity error is honoured when a rule has earned it", () => {
  const rule = scoreRule({ at: 2, severity: "error" });
  const g = gate([
    { subject: subjectOf({ rule }), answer: { value: 2.9, confidence: 0.9, kind: "score" } },
  ]);
  assert.match(formatGithub({ ...g, rules: [rule] }), /^::error /);
});

// ------------------------------------------------------------------- jev

await testAsync("jev: no API key is an auth error, not a crash mid-run", async () => {
  const jev = new Jev({ apiKey: "" });
  await assert.rejects(() => jev.ask({}, { q0000: {} }), (err) => {
    assert.ok(err instanceof JevError);
    assert.equal(err.kind, "auth");
    return true;
  });
});

await testAsync("jev: an empty question set costs nothing and makes no request", async () => {
  let called = false;
  const jev = new Jev({ apiKey: "k", onRequest: () => (called = true) });
  const res = await jev.ask({}, {});
  assert.deepEqual(res.answers, {});
  assert.equal(called, false);
  assert.equal(jev.calls, 0);
});

await testAsync("jev: a too-big request is halved until it fits, and answers merge", async () => {
  const jev = new Jev({ apiKey: "k", retries: 0 });
  const seen = [];
  let calls = 0;
  jev.ask = async (state, questions) => {
    calls += 1;
    const names = Object.keys(questions);
    if (names.length > 2) {
      throw new JevError("max_tokens_exceeded", { status: 400, kind: "too_big" });
    }
    seen.push(names);
    return {
      answers: Object.fromEntries(names.map((n) => [n, { type: "noul", noul: 0.5 }])),
      usage: { input_tokens: 10 },
    };
  };
  const questions = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [questionId(i), { type: "noul" }]),
  );
  const res = await jev.askSplitting({}, questions);
  assert.equal(Object.keys(res.answers).length, 8, "every question must come back");
  assert.equal(res.usage.input_tokens, 40);
  assert.ok(seen.every((s) => s.length <= 2));
  assert.ok(calls > 1);
});

await testAsync("jev: a single question that is still too big is not retried forever", async () => {
  const jev = new Jev({ apiKey: "k" });
  jev.ask = async () => {
    throw new JevError("max_tokens_exceeded", { status: 400, kind: "too_big" });
  };
  await assert.rejects(() => jev.askSplitting({}, { q0000: {} }), /max_tokens_exceeded/);
});

await testAsync("jev: usage is priced at the published input rate", async () => {
  const jev = new Jev({ apiKey: "k" });
  jev.inputTokens = 1_000_000;
  assert.ok(Math.abs(jev.usd - 0.042) < 1e-9);
});

// ----------------------------------------------------------------- wiring

await testAsync("end to end: the shipped pack finds the corpus defects it is fitted to", async () => {
  // The one test that touches ast-grep. It asserts the MATCHING and the
  // plumbing, never a verdict: no request is made, so there is no answer to
  // assert. That the rules separate their classes is measured by
  // `jevlint calibrate`, and recorded in docs/data/calibration.json.
  const { collectSubjects } = await import("../src/run.mjs");
  const { rules } = loadRules(["rules"]);
  const { subjects } = await collectSubjects({ rules, paths: ["corpus"] });
  assert.ok(subjects.length > 50, `expected the corpus to produce subjects, got ${subjects.length}`);

  const byRule = new Map();
  for (const s of subjects) byRule.set(s.rule.id, (byRule.get(s.rule.id) ?? 0) + 1);
  for (const r of rules) {
    assert.ok(byRule.get(r.id) > 0, `${r.id} matched nothing in the corpus`);
  }

  // The naming rules only work if the matcher hands over the captured name.
  const named = subjects.filter((s) => Object.keys(s.captured ?? {}).length > 0);
  assert.ok(named.length > 20, "captures should reach most naming subjects");

  // A file subject is one per file and carries an outline, not source.
  const fileSubjects = subjects.filter((s) => s.rule.subject === "file");
  assert.ok(fileSubjects.length >= 8);
  assert.ok(fileSubjects.every((s) => s.isOutline && s.text.startsWith("path: ")));
});

await testAsync("end to end: overlapping grammars produce one subject per node", async () => {
  // `.js` and `.mjs` are claimed by BOTH the JavaScript and Jsx grammars, so a
  // rule listing them matched every node twice and reported every finding
  // twice. Found by running this tool on its own source.
  const { collectSubjects } = await import("../src/run.mjs");
  const dir = mkdtempSync(join(tmpdir(), "jevlint-test-"));
  try {
    writeFileSync(join(dir, "a.mjs"), 'test("one", () => {});\ntest("two", () => {});\n');
    const rule = normalizeRule({
      id: "dup",
      languages: ["JavaScript", "Jsx"],
      kind: "noul",
      rule: { pattern: "test($T, $B)" },
      ask: "a",
      criteria: { true: "y", false: "n" },
    }).rule;
    const { subjects, duplicateGrammars } = await collectSubjects({
      rules: [rule],
      paths: [dir],
    });
    assert.equal(subjects.length, 2, "two calls, two subjects, not four");
    assert.equal(duplicateGrammars, 2, "the duplicates should be counted, not merely dropped");
    // Two distinct nodes must survive; dedupe must key on the range, not the file.
    assert.equal(new Set(subjects.map((s) => s.line)).size, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
