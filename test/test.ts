#!/usr/bin/env node
/**
 * The test suite. No API key, no network, no ast-grep binary required except
 * where a test says so.
 *
 * What gets tested here is chosen deliberately. The model's accuracy is
 * measured by `jev-lint calibrate` against a labeled corpus, not asserted here --
 * a probabilistic answer has no expected value to assert. What IS asserted is
 * everything around it, and above all the FAILURE PATHS: a review tool that can
 * break a build is worse than no review tool, so every way this can fail has to
 * land on "no verdict" rather than on an exception.
 */
import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";

import { PROBE_PREFIX } from "../src/types.ts";
import {
  normalizeRule,
  loadRules,
  cutoffFor,
  ruleTextHash,
  normalizeLanguage,
  defaultRulePaths,
  SCORE_LEVELS,
  DEFAULT_SCORE_AT,
} from "../src/rules.ts";
import { buildQuestion, questionId, readAnswer } from "../src/questions.ts";
import { buildState, resolveSubject, renderOutline, capturedMetavariables } from "../src/state.ts";
import {
  planBatches,
  planRuleBatches,
  estimateTokens,
  MAX_STATE_TOKENS,
  STATE_BUDGET,
  REQUEST_BUDGET,
  STATE_MARGIN,
  REQUEST_MARGIN,
  DEFAULT_BATCH_SIZE,
} from "../src/batch.ts";
import { schedule, planMixed, explain } from "../src/schedule.ts";
import { decide, gate, describe as describeFinding, blocks } from "../src/gate.ts";
import { Cache, verdictKey } from "../src/cache.ts";
import { parseUnifiedDiff, touchesChange, changedRanges, changedFilesUnder } from "../src/diff.ts";
import { widestGap, gapReport, fitCutoffs, labelFor, stabilityReport } from "../src/calibrate.ts";
import {
  buildSymbols,
  enclosingSymbol,
  moduleIdentity,
  emitRuleFile,
  astGrepRuleId,
  baseRuleId,
  toAstGrepRule,
} from "../src/scan.ts";
import { formatGithub, formatJson, formatPretty, silentRules } from "../src/report.ts";
import { Jev, JevError, API_KEY_VARS, DEFAULT_BASE_URL, fromEnv } from "../src/jev.ts";
import {
  applyConfig,
  findConfig,
  initialConfig,
  initialHook,
  loadConfig,
  type Configurable,
} from "../src/config.ts";
import { parseIgnores, isIgnored, unknownIgnoredRules } from "../src/ignore.ts";
import { mergePasses } from "../src/run.ts";
import type {
  Answer,
  AstGrepMatch,
  Finding,
  Question,
  FileSymbols,
  Rule,
  StateArm,
  Subject,
} from "../src/types.ts";
import type { ChangedRanges } from "../src/diff.ts";
import type { Labels } from "../src/types.ts";

/** Typed label fixtures, so the `$`-prefixed metadata keys check out. */
const labelsOf = (o: Record<string, unknown>): Labels => o as Labels;

/** A structural-probe match, as buildSymbols consumes them. */
const probeMatch = (
  ruleId: string,
  file: string,
  language: string,
  text: string,
  start: number,
  end: number,
  line: number,
  endLine: number,
  name?: string,
): AstGrepMatch => ({
  ruleId,
  file,
  language,
  text,
  range: {
    byteOffset: { start, end },
    start: { line, column: 0 },
    end: { line: endLine, column: 0 },
  },
  ...(name ? { metaVariables: { single: { JEVNAME: { text: name } } } } : {}),
});

let passCount = 0;
let failCount = 0;
const only = process.argv[2] ?? null;

function test(name: string, fn: () => void): void {
  if (only && !name.includes(only)) return;
  try {
    fn();
    passCount += 1;
  } catch (err: unknown) {
    failCount += 1;
    process.stdout.write(
      `FAIL  ${name}\n      ${String((err as Error).message).split("\n").join("\n      ")}\n`,
    );
  }
}

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  if (only && !name.includes(only)) return;
  try {
    await fn();
    passCount += 1;
  } catch (err: unknown) {
    failCount += 1;
    process.stdout.write(
      `FAIL  ${name}\n      ${String((err as Error).message).split("\n").join("\n      ")}\n`,
    );
  }
}

const scoreRule = (over: Record<string, unknown> = {}): Rule => {
  const { rule, error } = normalizeRule({
    id: "r",
    language: "TypeScript",
    rule: { pattern: "fetch($$$)" },
    ask: "fetch must be given a timeout",
    ...over,
  });
  assert.equal(error, undefined, `fixture rule invalid: ${error}`);
  return rule!;
};

const noulRule = (over: Record<string, unknown> = {}): Rule =>
  normalizeRule({
    id: "n",
    language: "Rust",
    kind: "noul",
    rule: { kind: "function_item" },
    ask: "this function hides a failure",
    criteria: { true: "it does", false: "it does not" },
    ...over,
  }).rule!;

const subjectOf = (over: Partial<Subject> = {}): Subject => ({
  rule: scoreRule(),
  file: "a.ts",
  line: 3,
  endLine: 5,
  text: "fetch(url)",
  nodeKind: "call_expression",
  arm: "located" as StateArm,
  language: "TypeScript",
  captured: {},
  enclosing: null,
  promoted: false,
  ...over,
});

// ---------------------------------------------------------------- rules

test("rules: a project's own ./rules wins, and a fresh install still finds the packs", () => {
  // Every fresh install used to exit 2 with "no usable rules found in rules":
  // the default was the literal relative path `rules`, and the shipped packs
  // live in `node_modules/jev-lint/rules`, so `npm install jev-lint && npx
  // jev-lint check src` could not work at all. An audit of the README's own
  // install block caught it. Both directions are pinned, because the wrong one
  // silently judges someone's code against cutoffs fitted to a corpus their
  // code has never seen.
  const here = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-rules-"));
  try {
    process.chdir(dir);
    const [fallback, isShipped] = defaultRulePaths();
    assert.equal(isShipped, true, "no ./rules here, so the packaged packs must be used");
    assert.ok(isAbsolute(fallback[0]!), "and by absolute path, since the cwd is not the package");
    assert.ok(existsSync(fallback[0]!), `${fallback[0]} must exist`);
    assert.ok(loadRules(fallback).rules.length > 0, "and must actually load");

    mkdirSync(join(dir, "rules"));
    const [local, stillShipped] = defaultRulePaths();
    assert.deepEqual(local, ["rules"], "a project's own rules win once they exist");
    assert.equal(stillShipped, false);
  } finally {
    process.chdir(here);
    rmSync(dir, { recursive: true, force: true });
  }
});

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
  const badPatches: Array<[string, Record<string, unknown>]> = [
    ["ask", { ask: "  " }],
    ["rule", { rule: undefined }],
    ["id", { id: "" }],
    ["language", { language: "Klingon" }],
  ];
  for (const [field, patch] of badPatches) {
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
  const rejected = normalizeRule({
    id: "n",
    language: "Rust",
    kind: "noul",
    rule: { kind: "function_item" },
    ask: "a",
    true: "yes",
    false: "no",
  });
  assert.ok(rejected.error, "a noul with top-level true/false must be rejected");
  assert.match(rejected.error, /criteria/);

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

test("rules: a reserved probe id is an error, not a silently dead rule", () => {
  // The prefix was reserved by comment only. A rule id starting with it had
  // every match routed into the probe stream, produced no subjects, and showed
  // up in the report as a `silent` rule with no explanation -- a silent matcher
  // failure, which is the failure mode this design spends the most effort
  // avoiding.
  const r = normalizeRule(
    { id: `${PROBE_PREFIX}mine`, language: "TypeScript", rule: { kind: "x" }, ask: "a?" },
    "t",
  );
  assert.ok(r.error, "a reserved id must be rejected");
  assert.match(r.error, /reserved/);
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
  }).rule!;
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
  // The matcher too. It reaches the model as the question's `node` field and
  // as `matcher_captured`, and neither is in the subject text the verdict key
  // hashes -- so a matcher edit that changes what is captured would otherwise
  // serve the verdicts of the old question. Same for what shapes the matcher.
  assert.notEqual(ruleTextHash(base), ruleTextHash(scoreRule({ rule: { pattern: "fetch($URL, $$$)" } })));
  assert.notEqual(
    ruleTextHash(base),
    ruleTextHash(scoreRule({ constraints: { URL: { regex: "^'" } } })),
  );
  assert.notEqual(
    ruleTextHash(base),
    ruleTextHash(scoreRule({ utils: { "is-call": { kind: "call_expression" } } })),
  );
  // But only the matcher's meaning, not its spelling: reordering YAML keys is
  // not a new draft.
  assert.equal(
    ruleTextHash(scoreRule({ rule: { kind: "call_expression", pattern: "fetch($$$)" } })),
    ruleTextHash(scoreRule({ rule: { pattern: "fetch($$$)", kind: "call_expression" } })),
  );
});

test("rules: two language variants sharing an anchor still hash apart, on the matcher", () => {
  // They used to share a hash, and a test asserted it. The property was
  // decorative: the verdict key has the id in it, so the variants never shared
  // a cache entry anyway -- and a hash that ignores the matcher is a hash that
  // serves stale verdicts after a matcher edit. The anchors still work; they
  // just do not buy a shared hash.
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-test-"));
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
    assert.equal(rules[0]!.ask, rules[1]!.ask, "the anchor is honoured");
    assert.deepEqual(rules[0]!.criteria, rules[1]!.criteria);
    assert.notEqual(ruleTextHash(rules[0]!), ruleTextHash(rules[1]!));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rules: a duplicate id is reported and a missing path is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-test-"));
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
  // Deliberately inspecting a field the type says cannot be there: the point of
  // the check is that the wire shape has no top-level `true`.
  assert.equal((q as unknown as Record<string, unknown>).true, undefined, "criteria must not be hoisted to the top level");
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
    readAnswer({ q0000: { type: "noul", noul: 0.9, confidence: 0.3 } }, "q0000", "noul")!.confidence,
    null,
  );
});

// ----------------------------------------------------------------- state

const sampleEntry = (): FileSymbols => ({
  language: "TypeScript",
  imports: ['import { db } from "./db"'],
  exportRanges: [] as Array<[number, number]>,
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
    subjects: [subjectOf({ id: "q0000", nodeKind: "call", line: 3, endLine: 3 })],
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
  assert.equal(graph.symbols!.length, 2);
  assert.equal((graph.module as { stem: string }).stem, "a");
  assert.deepEqual(graph.imports, ['import { db } from "./db"']);

  const full = buildState({ ...args, arm: "full" });
  assert.equal(full.source, "SOURCE");
  assert.equal(full.symbols!.length, 2);
});

test("state: every question appears in the subject index on every arm", () => {
  const subjects = [
    subjectOf({ id: "q0000", nodeKind: "call", line: 3, endLine: 3 }),
    subjectOf({ id: "q0001", nodeKind: "call", line: 9, endLine: 11 }),
  ];
  for (const arm of ["bare", "located", "graph", "full"] as StateArm[]) {
    const s = buildState({
      file: "a.ts",
      source: "x",
      entry: sampleEntry(),
      subjects,
      arm,
      language: "TypeScript",
    });
    assert.deepEqual(s.subjects.map((x) => x.id), ["q0000", "q0001"], `arm ${arm}`);
    assert.equal(s.subjects[1]!.lines, "9-11");
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
  assert.deepEqual(s.symbols![0]!.calls, ["inner"]);
  assert.deepEqual(s.symbols![1]!.called_by, ["outer"]);
  assert.equal(s.symbols![0]!.exported, true);
});

const matchAt = (start: number, end: number, over: Partial<AstGrepMatch> = {}): AstGrepMatch => ({
  ruleId: "r",
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

test("state: subject enclosing promotes the judged code but reports the match", () => {
  const s = resolveSubject(matchAt(60, 70), scoreRule({ subject: "enclosing" }), sampleEntry());
  assert.equal(s.text, "function inner() {}", "the container is what gets judged");
  assert.equal(s.promoted, true);
  // Two separate things: a reader is sent to the line that matched, and the
  // model is told the range of the code it was actually given. Collapsing them
  // sends readers to the top of a long function and makes every match inside
  // one function share a reported line.
  assert.equal(s.line, 6, "the finding reports the match's line");
  assert.equal(s.subjectLine, 5, "the question describes the container's range");
  assert.equal(s.subjectEndLine, 9);
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
  assert.equal(enclosingSymbol(e, 60, 70)!.name, "inner");
  assert.equal(enclosingSymbol(e, 10, 20)!.name, "outer");
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

test("state: the outline carries each symbol's signature, not only its name", () => {
  // The file-consistency candidates could not run on `graph`: whether one
  // export returns a Result while its siblings throw, or takes (ctx, input)
  // while the rest take (input, ctx), is a fact about signatures, and the
  // outline had names and line numbers only. They had to carry the whole
  // source instead. The signature is the text up to the body, one line,
  // whitespace collapsed, capped -- what a reader scans in a file's fold.
  const entry = sampleEntry();
  entry.symbols[0]!.text = "export async function outer(\n  ctx: Ctx,\n  input: Input,\n): Promise<Result<Out>> {\n  return inner(ctx);\n}";
  entry.symbols[1]!.text = "const inner = (ctx: Ctx) => {\n  throw new Error();\n};";
  const out = renderOutline("src/api/user.ts", entry);
  assert.match(out, /outer \(function, lines 1-20\): export async function outer\( ctx: Ctx, input: Input, \): Promise<Result<Out>>/);
  assert.match(out, /inner \(function, lines 5-9\): const inner = \(ctx: Ctx\) =>/);
  assert.doesNotMatch(out, /return inner/, "the body stays out of the outline");
  // A very long signature is cut, so one generic monster cannot blow the state budget.
  entry.symbols[0]!.text = `function outer(${"a: number, ".repeat(60)}) {}`;
  const cut = renderOutline("src/api/user.ts", entry).split("\n").find((l) => l.includes("outer ("))!;
  assert.ok(cut.length < 260, `signature line should be capped, got ${cut.length}`);
  assert.match(cut, /…$/);
});

test("state: a module with no named items says so rather than rendering nothing", () => {
  const out = renderOutline("src/empty.ts", {
    language: "TypeScript",
    symbols: [],
    imports: [],
    exportRanges: [],
  });
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
    ...matchAt(0, 1),
    metaVariables: {
      single: {
        JEVNAME: { text: "probe-only" },
        NAME: { text: "loadUser" },
        BIG: { text: "y".repeat(2000) },
      },
      // ast-grep's own bookkeeping for a relational sub-match (`has`, `inside`):
      // the text of whatever the sub-rule matched, under a name no rule wrote.
      // It reached the model as `matcher_captured.secondary` on 62 of the
      // corpus's 276 subjects before `--show-subjects` made it visible.
      multi: { ARGS: [{ text: "a" }, { text: "b" }], secondary: [{ text: "loadUser" }] },
    },
  });
  assert.equal(c.JEVNAME, undefined);
  assert.equal(c.secondary, undefined, "ast-grep's internal capture is not the rule's");
  assert.equal(c.NAME, "loadUser");
  assert.ok(c.BIG.length <= 601);
  assert.equal(c.ARGS, "a, b");
});

// ----------------------------------------------------------------- batch

const manySubjects = (n: number, over: Partial<Subject> = {}): Subject[] =>
  Array.from({ length: n }, (_, i) =>
    subjectOf({ line: i + 1, endLine: i + 1, text: `call${i}()`, ...over }),
  );

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

// ------------------------------------------------- batch: the rule axis

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

// ------------------------------------------------------- the scheduler

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

// ------------------------------------------------------------------ gate

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

test("cache: a key covers the draft, the arm and the axis, but not the threshold", () => {
  const r = scoreRule();
  const k = verdictKey(r, "located", "TEXT");
  assert.equal(k, verdictKey(scoreRule({ at: 2.9 }), "located", "TEXT"));
  assert.notEqual(k, verdictKey(scoreRule({ ask: "other" }), "located", "TEXT"));
  assert.notEqual(k, verdictKey(r, "bare", "TEXT"));
  assert.notEqual(k, verdictKey(r, "located", "OTHER"));
  // The axis was in the key and untested, because every call here used the
  // default. It has to be in it: the same subject at the same arm sits beside
  // its own file's matches under file grouping and beside unrelated ones under
  // rule grouping, and those are different questions.
  assert.notEqual(k, verdictKey(r, "located", "TEXT", "rule"));
  assert.equal(k, verdictKey(r, "located", "TEXT", "file"));

  // And the arm in the key has to be the arm the question was ASKED at, not
  // the one the rule asked for. A batch over the state budget steps down, so a
  // `located` rule can be answered at `local`; filing that answer under the
  // `located` key served it, later, as the answer to a question nobody asked.
  // Distinct keys are what make that a miss instead.
  assert.notEqual(verdictKey(r, "located", "TEXT"), verdictKey(r, "local", "TEXT"));

  // A promoted subject (`subject: enclosing`) has the enclosing function as
  // its text and the match as `matchText`, and the question carries BOTH. Two
  // `catch` clauses in one function are two questions; keyed on the text
  // alone they were one, and the second was never asked -- it was handed the
  // first one's verdict as a twin. Found by the family-C candidate rules:
  // every same-function pair had byte-identical scores over three passes,
  // one of them a labelled defect nobody had been asked about.
  assert.notEqual(
    verdictKey(r, "located", "function f() { … }", "file", "catch (a) { return null }"),
    verdictKey(r, "located", "function f() { … }", "file", "catch (b) { throw b }"),
  );
  // And an unpromoted subject, with no match of its own, keys as before, so
  // duplicated code across files still costs one question.
  assert.equal(verdictKey(r, "located", "TEXT", "file", null), verdictKey(r, "located", "TEXT"));
});

test("cache: a missing, unreadable, malformed or stale file means no verdict, never a throw", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-test-"));
  try {
    const fromMissingFile = Cache.load(join(dir, "nope.json"));
    assert.equal(fromMissingFile.get("k", "score"), null);

    writeFileSync(join(dir, "bad.json"), "{not json");
    const fromMalformedFile = Cache.load(join(dir, "bad.json"));
    assert.equal(fromMalformedFile.get("k", "score"), null);
    assert.ok(fromMalformedFile.loadError);

    writeFileSync(join(dir, "old.json"), JSON.stringify({ schema: "ancient", entries: { k: { value: 3 } } }));
    const fromStaleSchema = Cache.load(join(dir, "old.json"));
    assert.equal(fromStaleSchema.get("k", "score"), null);
    assert.ok(fromStaleSchema.loadError);

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
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-test-"));
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
  // Deliberately the wrong type for `value`: the point is that a non-numeric
  // verdict is never stored, and the type says it cannot happen.
  c.set("k", { value: "2", kind: "score" } as unknown as Answer);
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
  const ranges: ChangedRanges = new Map([["a.ts", [[10, 20]]]]);
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

// ------------------------------------------------------------------ scan

test("scan: emitted rules are valid ast-grep rules with jev-lint fields stripped", () => {
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
  }).rule!;
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
  }).rule!;
  const emitted = toAstGrepRule(r, "TypeScript");
  assert.deepEqual(emitted.constraints, { A: { regex: "^this$" } });
  assert.deepEqual(emitted.utils, { helper: { kind: "identifier" } });
});

test("scan: symbols come out nested, visibility resolved, with call edges", () => {
  // Two containers, an export wrapper and an import, as the probes report them.
  const probes: AstGrepMatch[] = [
    probeMatch("__jev-lint_c0_TypeScript", "a.ts", "TypeScript", "function outer() { return inner(); }", 7, 60, 0, 4, "outer"),
    probeMatch("__jev-lint_c0_TypeScript", "a.ts", "TypeScript", "function inner() { return 1; }", 70, 100, 6, 8, "inner"),
    probeMatch("__jev-lint_e0_TypeScript", "a.ts", "TypeScript", "export function outer() {}", 0, 60, 0, 4),
    probeMatch("__jev-lint_i0_TypeScript", "a.ts", "TypeScript", 'import { db } from "./db";', 200, 226, 10, 10),
  ];
  const syms = buildSymbols(probes, ["TypeScript"]);
  const entry = syms.get("a.ts")!;
  const outer = entry.symbols.find((s) => s.name === "outer")!;
  const inner = entry.symbols.find((s) => s.name === "inner")!;
  assert.equal(outer.exported, true, "containment in an export_statement resolves visibility");
  assert.equal(inner.exported, false);
  assert.deepEqual(outer.calls, ["inner"]);
  assert.deepEqual(inner.calledBy, ["outer"]);
  assert.deepEqual(entry.imports, ['import { db } from "./db";']);
});

test("scan: two symbols sharing a name do not form a call edge with each other", () => {
  // Rust's `struct Cache` and `impl Cache` share one name.
  const mk = (role: string, start: number, end: number): AstGrepMatch =>
    probeMatch(
      role === "struct" ? "__jev-lint_c2_Rust" : "__jev-lint_c1_Rust",
      "a.rs",
      "Rust",
      role === "struct" ? "pub struct Cache { }" : "impl Cache { }",
      start,
      end,
      0,
      1,
      "Cache",
    );
  const syms = buildSymbols([mk("struct", 0, 20), mk("impl", 30, 60)], ["Rust"]);
  for (const s of syms.get("a.rs")!.symbols) {
    assert.deepEqual(s.calls, [], `${s.role} must not call itself by name`);
    // An edge has two halves and only one was checked, so a bug that recorded
    // the reverse direction passed. jev-lint flagged the name over that.
    assert.deepEqual(s.calledBy, [], `${s.role} must not be called by its own name`);
  }
  // And the absence above has to mean "no edge", not "no graph": the same
  // machinery must still connect two symbols with DIFFERENT names.
  const twoNamedItems = buildSymbols(
    [
      probeMatch("__jev-lint_c0_Rust", "b.rs", "Rust", "pub fn caller() { callee() }", 0, 28, 0, 0, "caller"),
      probeMatch("__jev-lint_c0_Rust", "b.rs", "Rust", "pub fn callee() {}", 30, 48, 2, 2, "callee"),
    ],
    ["Rust"],
  ).get("b.rs")!;
  assert.deepEqual(twoNamedItems.symbols.find((s) => s.name === "caller")!.calls, ["callee"]);
});

test("scan: every symbol has call arrays, including ones excluded from the graph", () => {
  // "Every symbol" on a single symbol was what jev-lint flagged here: the one
  // case tested was the excluded one, so the claim about the rest was carried
  // by the name alone. Both classes are present now.
  // What "excluded" means here is `role: module`: `computeCalls` builds edges
  // only between named non-module symbols, so a module is the one kind that
  // never appears in the graph and still has to carry the arrays.
  const probes: AstGrepMatch[] = [
    probeMatch("__jev-lint_c5_Rust", "a.rs", "Rust", "mod tests { }", 0, 13, 0, 0, "tests"),
    probeMatch("__jev-lint_c0_Rust", "a.rs", "Rust", "pub fn f() { g() }", 20, 38, 2, 2, "f"),
    probeMatch("__jev-lint_c0_Rust", "a.rs", "Rust", "pub fn g() {}", 40, 53, 4, 4, "g"),
  ];
  const entry = buildSymbols(probes, ["Rust"]).get("a.rs")!;
  assert.equal(entry.symbols.length, 3);
  for (const s of entry.symbols) {
    assert.ok(Array.isArray(s.calls), `${s.name} has no calls array`);
    assert.ok(Array.isArray(s.calledBy), `${s.name} has no calledBy array`);
  }
  const excluded = entry.symbols.find((s) => s.role === "module")!;
  assert.ok(excluded, "the module is the excluded class");
  assert.deepEqual(excluded.calls, []);
  assert.deepEqual(excluded.calledBy, []);
  // The included class is only meaningful if the graph actually ran, so assert
  // the edge it should have produced rather than just the array's existence.
  assert.deepEqual(entry.symbols.find((s) => s.name === "f")!.calls, ["g"]);
  assert.deepEqual(entry.symbols.find((s) => s.name === "g")!.calledBy, ["f"]);
});

test("scan: Rust visibility and test markers come from the item's own text", () => {
  const mk = (text: string): AstGrepMatch =>
    probeMatch("__jev-lint_c0_Rust", "a.rs", "Rust", text, 0, text.length, 0, 0, "f");
  const pub = buildSymbols([mk("pub fn f() {}")], ["Rust"]).get("a.rs")!.symbols[0]!;
  const priv = buildSymbols([mk("fn f() {}")], ["Rust"]).get("a.rs")!.symbols[0]!;
  const test_ = buildSymbols([mk("#[cfg(test)] mod f {}")], ["Rust"]).get("a.rs")!.symbols[0]!;
  assert.equal(pub.exported, true);
  assert.equal(priv.exported, false);
  assert.equal(test_.isTest, true);
});

// ---------------------------------------------------------------- report

test("report: a finding that did not reproduce in every pass says so", () => {
  // The whole point of --retry. A finding the mean reports but only some passes
  // did is the case the calibration discipline says to route to a person, so it
  // cannot look identical to one that reproduced three times out of three.
  const rule = noulRule({ id: "n", at: 0.6 });
  const stable = decide(subjectOf({ rule, file: "a.ts", line: 1 }), {
    value: 0.9,
    confidence: null,
    kind: "noul",
  });
  stable.passes = { over: 3, of: 3, spread: 0.01 };
  const flaky = decide(subjectOf({ rule, file: "a.ts", line: 2 }), {
    value: 0.62,
    confidence: null,
    kind: "noul",
  });
  flaky.passes = { over: 1, of: 3, spread: 0.24 };

  const text = formatPretty(
    { findings: [stable, flaky], all: [stable, flaky], stats: gate([]).stats, retry: 3 } as never,
    { color: false },
  );
  assert.match(text, /3\/3 passes/);
  assert.match(text, /1\/3 passes/);
  assert.match(text, /did not reproduce in every pass \(spread 0\.24\)/);
  assert.equal(
    (text.match(/did not reproduce/g) ?? []).length,
    1,
    "only the one that actually flickered",
  );
});

test("report: a suppression is reported, and so is one naming a missing rule", () => {
  // A suppression removes a subject before it is asked about, so nothing else
  // in the output would show that a rule had been quieted.
  const text = formatPretty(
    {
      findings: [],
      all: [],
      stats: gate([]).stats,
      ignored: { subjects: 4, files: ["b.ts"], unknownRules: ["fn-name-promisez"] },
    } as never,
    { color: false },
  );
  assert.match(text, /4 subject\(s\) skipped by jev-lint-ignore comments/);
  assert.match(text, /1 file\(s\) suppressed whole: b\.ts/);
  assert.match(text, /name a rule that does not exist: fn-name-promisez/);
  assert.match(text, /suppress nothing/);
});

test("report: rules that produced no subject are listed", () => {
  const fired = scoreRule({ id: "fired" });
  const quiet = scoreRule({ id: "quiet" });
  const result = { rules: [fired, quiet], subjects: [{ rule: fired } as Subject] };
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
  const result = { ...g, rules: [] as Rule[], subjects: [] as Subject[], elapsedMs: 1 };
  assert.match(formatGithub(result), /this run is incomplete/);
  assert.equal(JSON.parse(formatJson(result)).stats.missing, 1);
  // The third format. This assertion was missing, and jev-lint's own
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
  await assert.rejects(
    () =>
      jev.ask({}, {
        q0000: { type: "noul", instructions: {}, criteria: { true: "y", false: "n" } },
      }),
    (err: unknown) => {
      assert.ok(err instanceof JevError);
      assert.equal((err as JevError).kind, "auth");
      return true;
    },
  );
});

test("jev: a billing refusal is an auth error, since retrying will not help", () => {
  // 402 came back on every one of 69 requests in a run -- 23 batches times 3
  // passes -- because it was classified `other`, and `other` is per batch.
  assert.equal(Jev.classify(402, ""), "auth");
  assert.equal(Jev.classify(401, ""), "auth");
  assert.equal(Jev.classify(403, ""), "auth");
  assert.equal(Jev.classify(400, "max_tokens_exceeded"), "too_big");
  assert.equal(Jev.classify(400, "bad json"), "other");
  assert.equal(Jev.classify(500, ""), "other");
});

await testAsync("run: an auth error stops the run instead of failing every batch and every pass", async () => {
  // A key that does not work on the first batch does not work on the other
  // twenty-two, or on the next two passes. Sending them anyway is 69 failed
  // requests for one cause, a wall of identical error rows, and -- with
  // retries and backoff -- minutes of waiting for nothing. The subjects still
  // come back without a verdict, and the one error is still reported.
  const { run } = await import("../src/run.ts");
  const rule = scoreRule({ id: "r", rule: { kind: "function_declaration" } });
  let calls = 0;
  const client = {
    model: "fake",
    servedModel: null,
    spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
    askSplitting: async () => {
      calls += 1;
      throw new JevError("HTTP 402: no credits", { status: 402, kind: "auth" });
    },
  };
  const result = await run({
    rules: [rule],
    paths: ["corpus/ts"],
    cachePath: null,
    retry: 3,
    concurrency: 1,
    client,
  });
  assert.ok(result.subjects.length > 3, "the corpus must produce several batches");
  assert.equal(calls, 1, "one refusal is enough; nothing after it should be sent");
  assert.equal(result.errors?.length, 1, "and reported once, not once per batch");
  assert.match(result.errors![0]!.error, /402/);
  assert.equal(result.stats.missing, result.subjects.length, "every subject is missing, none is clean");
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
  const seen: string[][] = [];
  let calls = 0;
  jev.ask = async (_state: unknown, questions: Record<string, Question>) => {
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
    Array.from({ length: 8 }, (_, i) => [
      questionId(i),
      { type: "noul", instructions: {}, criteria: { true: "y", false: "n" } },
    ]),
  ) as Record<string, Question>;
  const res = await jev.askSplitting({}, questions);
  assert.equal(Object.keys(res.answers!).length, 8, "every question must come back");
  assert.equal(res.usage!.input_tokens, 40);
  assert.ok(seen.every((s) => s.length <= 2));
  assert.ok(calls > 1);
});

await testAsync("jev: a single question that is still too big is not retried forever", async () => {
  const jev = new Jev({ apiKey: "k" });
  jev.ask = async () => {
    throw new JevError("max_tokens_exceeded", { status: 400, kind: "too_big" });
  };
  await assert.rejects(
    () =>
      jev.askSplitting({}, {
        q0000: { type: "noul", instructions: {}, criteria: { true: "y", false: "n" } },
      }),
    /max_tokens_exceeded/,
  );
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
  // `jev-lint calibrate`, and recorded in docs/data/calibration.json.
  const { collectSubjects } = await import("../src/run.ts");
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

await testAsync("end to end: every cookbook recipe loads and matches its fixture", async () => {
  // The cookbook is the part of the plugin a reader copies from, so a recipe
  // that does not load, or names a node kind the grammar does not have, is a
  // shipped defect. Every ```yaml block in it is written to a temp dir, loaded
  // as a rule file, and run over test/fixtures/cookbook, which holds one
  // instance of each shape. A fragment that is not a whole rule is fenced
  // ```yml in the cookbook, precisely so this picks up the complete ones only.
  const { collectSubjects } = await import("../src/run.ts");
  const md = readFileSync("skills/jev-lint/references/cookbook.md", "utf8");
  const blocks = [...md.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]!);
  assert.ok(blocks.length >= 8, `expected the cookbook to hold recipes, found ${blocks.length} yaml blocks`);
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-cookbook-"));
  try {
    blocks.forEach((b, i) => writeFileSync(join(dir, `recipe-${i}.yml`), b));
    const { rules, errors } = loadRules([dir]);
    assert.deepEqual(errors, [], "every recipe must load");
    const { subjects } = await collectSubjects({ rules, paths: ["test/fixtures/cookbook"] });
    const byRule = new Map<string, number>();
    for (const s of subjects) byRule.set(s.rule.id, (byRule.get(s.rule.id) ?? 0) + 1);
    for (const r of rules) {
      assert.ok((byRule.get(r.id) ?? 0) > 0, `cookbook recipe ${r.id} matched nothing in the fixture`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("end to end: overlapping grammars produce one subject per node", async () => {
  // `.js` and `.mjs` are claimed by BOTH the JavaScript and Jsx grammars, so a
  // rule listing them matched every node twice and reported every finding
  // twice. Found by running this tool on its own source.
  const { collectSubjects } = await import("../src/run.ts");
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-test-"));
  try {
    // `.mjs` deliberately: the whole point is that this extension is claimed by
    // BOTH the JavaScript and Jsx grammars. A `.ts` file is claimed by
    // TypeScript alone and would match once, testing nothing.
    writeFileSync(join(dir, "a.mjs"), 'test("one", () => {});\ntest("two", () => {});\n');
    const rule = normalizeRule({
      id: "dup",
      languages: ["JavaScript", "Jsx"],
      kind: "noul",
      rule: { pattern: "test($T, $B)" },
      ask: "a",
      criteria: { true: "y", false: "n" },
    }).rule!;
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


// ------------------------------------------------- suppression comments

test("ignore: a file-level marker with no rule named suppresses every rule", () => {
  const ig = parseIgnores(["// jev-lint-ignore-file", "const a = 1;"].join("\n"));
  assert.deepEqual(ig.file, []);
  assert.equal(isIgnored(ig, 2, "any-rule"), true);
  assert.equal(isIgnored(ig, 999, "another-rule"), true);
});

test("ignore: a marker naming rules suppresses only those", () => {
  const ig = parseIgnores("// jev-lint-ignore-file fn-name-promises, var-name-describes-value\n");
  assert.deepEqual(ig.file, ["fn-name-promises", "var-name-describes-value"]);
  assert.equal(isIgnored(ig, 1, "fn-name-promises"), true);
  assert.equal(isIgnored(ig, 1, "var-name-describes-value"), true);
  assert.equal(isIgnored(ig, 1, "comment-describes-declaration"), false);
});

test("ignore: next-line targets the line after the marker, and only that line", () => {
  const ig = parseIgnores(
    ["const a = 1;", "// jev-lint-ignore-next-line", "const b = 2;", "const c = 3;"].join("\n"),
  );
  assert.equal(isIgnored(ig, 3, "r"), true, "line 3 is the one after the marker on line 2");
  assert.equal(isIgnored(ig, 2, "r"), false, "not the marker's own line");
  assert.equal(isIgnored(ig, 4, "r"), false, "and not the one after that");
});

test("ignore: a marker in a string is not a suppression", () => {
  // The trap this anchoring exists for. These tests write the marker as string
  // literals, so an unanchored pattern would let THIS file silence itself --
  // and a self-suppressing test file is invisible: every rule still loads,
  // nothing is reported, and the run looks clean.
  const ig = parseIgnores(
    [
      `const marker = "// jev-lint-ignore-file";`,
      `writeFileSync(f, "// jev-lint-ignore-next-line");`,
      "const t = `// jev-lint-ignore-file`;",
      `  "// jev-lint-ignore-file",`,
      "const x = 1;",
    ].join("\n"),
  );
  assert.equal(ig.file, null, "no file-level suppression from a string literal");
  assert.equal(ig.lines.size, 0, "and no line-level one either");
});

test("ignore: every comment opener the shipped languages use", () => {
  for (const line of [
    "// jev-lint-ignore-file",
    "# jev-lint-ignore-file",
    "/* jev-lint-ignore-file */",
    " * jev-lint-ignore-file",
    "-- jev-lint-ignore-file",
    "<!-- jev-lint-ignore-file -->",
    "    // jev-lint-ignore-file",
    "//jev-lint-ignore-file",
    "// jev-lint-ignore-file:",
  ]) {
    const ig = parseIgnores(`${line}\nconst a = 1;`);
    assert.notEqual(ig.file, null, `${line} should suppress the file`);
    assert.deepEqual(ig.file, [], `${line} should name no rules`);
  }
});

test("ignore: a closing comment token is not read as a rule id", () => {
  // `/* jev-lint-ignore-file */` must not suppress a rule called `*/`.
  assert.deepEqual(parseIgnores("/* jev-lint-ignore-file */\nx").file, []);
  assert.deepEqual(parseIgnores("<!-- jev-lint-ignore-file -->\nx").file, []);
  assert.deepEqual(parseIgnores("/* jev-lint-ignore-file fn-name-promises */\nx").file, [
    "fn-name-promises",
  ]);
});

test("ignore: markers union, and a bare one widens a narrow one", () => {
  const ig = parseIgnores(
    ["// jev-lint-ignore-file rule-a", "// jev-lint-ignore-file rule-b", "x"].join("\n"),
  );
  assert.deepEqual(ig.file, ["rule-a", "rule-b"]);
  const widened = parseIgnores(
    ["// jev-lint-ignore-file rule-a", "// jev-lint-ignore-file", "x"].join("\n"),
  );
  assert.deepEqual(widened.file, [], "a marker naming nothing means everything");
});

test("ignore: a suppression naming a rule that does not exist is reported", () => {
  // A typo here is invisible in the worst way: the rule it meant to quiet keeps
  // firing and the author believes it is handled.
  const ig = parseIgnores("// jev-lint-ignore-next-line fn-name-promiseS, real-rule\nx");
  const unknown = unknownIgnoredRules([ig], ["real-rule", "fn-name-promises"]);
  assert.deepEqual(unknown, ["fn-name-promiseS"]);
  assert.deepEqual(unknownIgnoredRules([ig], ["real-rule", "fn-name-promiseS"]), []);
});

test("ignore: a file with no marker costs nothing", () => {
  const ig = parseIgnores("const a = 1;\nconst b = 2;\n");
  assert.equal(ig.file, null);
  assert.equal(ig.lines.size, 0);
});

// ------------------------------------------------- --retry, and the mean

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


// ------------------------------------------------- .jev-lint.yaml

const writeConfig = (dir: string, body: string): string => {
  const p = join(dir, ".jev-lint.yaml");
  writeFileSync(p, body);
  return p;
};

const configurable = (over: Partial<Configurable> = {}): Configurable => ({
  rules: [],
  rulesAreShipped: false,
  paths: [],
  cache: ".jev-lint-cache.json",
  model: null,
  baseUrl: null,
  group: "file",
  arm: null,
  concurrency: 4,
  batchSize: 256,
  ruleBatchCap: 32,
  retry: 1,
  unsureBelow: null,
  at: {},
  ...over,
});

test("config: a valid file parses into every setting it names", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-cfg-"));
  try {
    const p = writeConfig(
      dir,
      [
        "rules: my-rules",
        "paths: [src, lib]",
        "cache: none",
        "model: jev-1.13.0",
        "baseUrl: https://proxy.example/v1",
        "apiKeyEnv: MY_KEY",
        "group: rule",
        "arm: bare",
        "concurrency: 2",
        "retry: 3",
        "unsureBelow: 0.4",
        "at:",
        "  fn-name-promises: 0.8",
      ].join("\n"),
    );
    const { config, errors } = loadConfig(p);
    assert.deepEqual(errors, []);
    assert.deepEqual(config.rules, ["my-rules"], "a bare string becomes a one-item list");
    assert.deepEqual(config.paths, ["src", "lib"]);
    assert.equal(config.cache, null, "`none` disables the cache");
    assert.equal(config.baseUrl, "https://proxy.example/v1");
    assert.equal(config.group, "rule");
    assert.equal(config.arm, "bare");
    assert.equal(config.retry, 3);
    assert.equal(config.unsureBelow, 0.4);
    assert.deepEqual(config.at, { "fn-name-promises": 0.8 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: an API key in the file is an error, not a silently ignored field", () => {
  // A config file belongs in version control and a secret does not. Ignoring
  // the field would leave someone believing the key was picked up.
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-cfg-"));
  try {
    const { config, errors } = loadConfig(writeConfig(dir, "apiKey: sk-secret\n"));
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /not supported/);
    assert.match(errors[0]!, /apiKeyEnv/, "and it says what to do instead");
    assert.equal(Object.keys(config).length, 0, "nothing is taken from it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: an unknown key, a bad value and bad YAML are all reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-cfg-"));
  try {
    assert.match(loadConfig(writeConfig(dir, "concurency: 4\n")).errors[0]!, /not a known setting/);
    assert.match(loadConfig(writeConfig(dir, "group: sideways\n")).errors[0]!, /must be one of/);
    assert.match(loadConfig(writeConfig(dir, "retry: 0\n")).errors[0]!, /positive integer/);
    assert.match(loadConfig(writeConfig(dir, "arm: wide\n")).errors[0]!, /must be null or one of/);
    assert.match(loadConfig(writeConfig(dir, "unsureBelow: 2\n")).errors[0]!, /0 to 1/);
    assert.match(loadConfig(writeConfig(dir, "at: [1, 2]\n")).errors[0]!, /mapping of rule id/);
    assert.match(loadConfig(writeConfig(dir, "at:\n  r: yes\n")).errors[0]!, /must be a number/);
    assert.match(loadConfig(writeConfig(dir, "- a\n- b\n")).errors[0]!, /not a mapping/);
    assert.match(loadConfig(writeConfig(dir, "a: [unclosed\n")).errors.length ? "ok" : "", /ok/);
    // An empty file is valid and sets nothing.
    assert.deepEqual(loadConfig(writeConfig(dir, "\n")).errors, []);
    assert.deepEqual(loadConfig(writeConfig(dir, "\n")).config, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: a flag beats the file, and the file beats the default", () => {
  // The precedence that lets a project commit a config and still be overridden
  // for one run. `explicit` is why it works: `concurrency` is already 4 before
  // any file is read, so comparing against the default would let the file win
  // over a flag that happened to match it.
  const config = { concurrency: 2, group: "rule" as const, retry: 5 };

  const fromFile = configurable();
  applyConfig(fromFile, config, new Set());
  assert.equal(fromFile.concurrency, 2, "the file beats the built-in default");
  assert.equal(fromFile.group, "rule");
  assert.equal(fromFile.retry, 5);

  const fromFlag = configurable({ concurrency: 8, retry: 1 });
  applyConfig(fromFlag, config, new Set(["--concurrency", "-r"]));
  assert.equal(fromFlag.concurrency, 8, "a flag beats the file");
  assert.equal(fromFlag.retry, 1, "including its short form");
  assert.equal(fromFlag.group, "rule", "and leaves the settings it did not name");
});

test("config: per-rule cutoffs merge, so a flag overrides one and keeps the rest", () => {
  const opts = configurable({ at: { "fn-name-promises": 0.5 } });
  applyConfig(opts, { at: { "fn-name-promises": 0.99, "var-name-describes-value": 0.42 } }, new Set(["--at"]));
  assert.deepEqual(opts.at, { "fn-name-promises": 0.5, "var-name-describes-value": 0.42 });
});

test("config: naming the rules in the file means they are not the packaged ones", () => {
  // Otherwise the run would announce that it fell back to the packaged packs
  // while actually using the project's, which is the confusing half of both.
  const opts = configurable({ rules: ["/pkg/rules"], rulesAreShipped: true });
  applyConfig(opts, { rules: ["my-rules"] }, new Set());
  assert.deepEqual(opts.rules, ["my-rules"]);
  assert.equal(opts.rulesAreShipped, false);
});

test("config: the file is found by walking up, and only names jev-lint's own", () => {
  // Resolved, because `process.cwd()` is: on macOS the temp dir is a symlink
  // under /var and cwd reports the /private/var target.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-lint-cfg-")));
  const here = process.cwd();
  try {
    mkdirSync(join(dir, "a", "b"), { recursive: true });
    process.chdir(join(dir, "a", "b"));
    assert.equal(findConfig(), null, "nothing above a temp dir");
    writeConfig(dir, "concurrency: 2\n");
    assert.equal(findConfig(), join(dir, ".jev-lint.yaml"), "found two levels up");
  } finally {
    process.chdir(here);
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("diff: --staged reviews what the commit will contain, and nothing else", async () => {
  // A pre-commit hook runs `review --staged`. Before this, that also swept in
  // every untracked file -- not part of the commit -- and, with a configured
  // `paths:`, scanned the whole tree to discard most of it.
  const { execFileSync } = await import("node:child_process");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-lint-git-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  try {
    git("init", "-q");
    writeFileSync(join(dir, "a.ts"), "export function a() {}\n");
    git("add", "a.ts");
    git("commit", "-q", "-m", "base");
    writeFileSync(join(dir, "a.ts"), "export function a() {}\nexport function b() {}\n");
    git("add", "a.ts");                                             // staged edit
    writeFileSync(join(dir, "a.ts"), "export function a() {}\nexport function b() {}\nexport function c() {}\n"); // unstaged on top
    writeFileSync(join(dir, "new.ts"), "export function n() {}\n");
    git("add", "new.ts");                                           // staged new file
    writeFileSync(join(dir, "loose.ts"), "export function l() {}\n"); // untracked
    const staged = await changedRanges({ staged: true, cwd: dir });
    assert.deepEqual([...staged.keys()].sort(), ["a.ts", "new.ts"], "the untracked file is not in the commit");
    assert.deepEqual(staged.get("a.ts"), [[2, 2]], "the unstaged third line is not in the commit either");
    const working = await changedRanges({ cwd: dir });
    assert.ok(working.has("loose.ts"), "without --staged, an untracked file is reviewable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("diff: git's mnemonic prefixes are stripped like the default ones", () => {
  // With `diff.mnemonicPrefix = true` in the user's git config, a working-tree
  // diff says `+++ w/src/a.ts` and an index diff `+++ i/src/a.ts`. The parser
  // stripped only `b/`, so on such a machine `jev-lint review` scanned a file
  // called `w/src/a.ts`, found nothing, and printed a clean run with every
  // rule "matched nothing". Found on the author's own machine, after a
  // session of "review shows nothing, must be a docs-only change".
  for (const prefix of ["b", "w", "i", "c"]) {
    const r = parseUnifiedDiff(`--- a/src/a.ts\n+++ ${prefix}/src/a.ts\n@@ -1,0 +2,1 @@\n+x\n`);
    assert.deepEqual([...r.keys()], ["src/a.ts"], `prefix ${prefix}/`);
  }
  // And `--no-prefix` output, which has none.
  assert.deepEqual([...parseUnifiedDiff("--- src/a.ts\n+++ src/a.ts\n@@ -1,0 +2,1 @@\n+x\n").keys()], ["src/a.ts"]);
});

test("diff: a configured `paths:` narrows a review to the changed files under it, not the whole tree", () => {
  const changed = ["src/a.ts", "src/deep/b.ts", "test/t.ts", "docs/x.md", "srcx/c.ts"];
  assert.deepEqual(changedFilesUnder(changed, []), changed, "no paths: every changed file");
  assert.deepEqual(changedFilesUnder(changed, ["src"]), ["src/a.ts", "src/deep/b.ts"], "a directory, and not its prefix-twin");
  assert.deepEqual(changedFilesUnder(changed, ["test/t.ts"]), ["test/t.ts"], "a file names itself");
  assert.deepEqual(changedFilesUnder(changed, ["./src/", "test"]), ["src/a.ts", "src/deep/b.ts", "test/t.ts"], "spelling does not matter");
  assert.deepEqual(changedFilesUnder(changed, ["lib"]), [], "nothing under it: nothing to review, not everything");
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

await testAsync("config: the pre-commit hook init writes is a shell script that reviews the staged diff", async () => {
  const { execFileSync } = await import("node:child_process");
  const hook = initialHook();
  assert.ok(hook.startsWith("#!/bin/sh\n"));
  // `sh -n` parses without running: the hook must at least be valid shell.
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-hook-"));
  try {
    writeFileSync(join(dir, "pre-commit"), hook);
    execFileSync("sh", ["-n", join(dir, "pre-commit")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.match(hook, /review --staged/, "it judges what the commit contains, not the working tree");
  assert.match(hook, /--fail-on error/, "and blocks only on what a rule has earned");
  assert.match(hook, /TYPESAFE_API_KEY/, "and stands aside on a machine without a key");
});

test("config: the file init writes is valid, and sets nothing until uncommented", () => {
  // A starter config that errors, or that silently changes behaviour, is worse
  // than none.
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-cfg-"));
  try {
    const { config, errors } = loadConfig(writeConfig(dir, initialConfig()));
    assert.deepEqual(errors, [], "the shipped starter config must parse clean");
    assert.deepEqual(config, {}, "and change nothing until a line is uncommented");
    assert.match(initialConfig(), /apiKeyEnv/, "and it must say where the key goes");
    assert.ok(!/^\s*apiKey:/m.test(initialConfig()), "and never suggest putting the key in it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("jev: the key and the endpoint prefer TYPESAFE_ and fall back to TYPESAFEAI_", () => {
  // The prevailing spelling wins, and an environment that only has the older
  // name keeps working -- an existing setup should not become a config error.
  assert.deepEqual(API_KEY_VARS, ["TYPESAFE_API_KEY", "TYPESAFEAI_API_KEY"]);
  assert.equal(fromEnv(API_KEY_VARS, { TYPESAFEAI_API_KEY: "old" }), "old");
  assert.equal(fromEnv(API_KEY_VARS, { TYPESAFE_API_KEY: "new", TYPESAFEAI_API_KEY: "old" }), "new");
  assert.equal(fromEnv(API_KEY_VARS, { TYPESAFE_API_KEY: "   ", TYPESAFEAI_API_KEY: "old" }), "old",
    "blank is not set");
  assert.equal(fromEnv(API_KEY_VARS, {}), null);
});

test("jev: the endpoint is configurable and a trailing slash does not double up", () => {
  assert.equal(new Jev({ apiKey: "k" }).baseUrl, DEFAULT_BASE_URL);
  assert.equal(new Jev({ apiKey: "k", baseUrl: "https://proxy.example/v1/" }).baseUrl,
    "https://proxy.example/v1", "or the request path would contain //");
});

process.stdout.write(`\n${passCount} passed, ${failCount} failed\n`);
process.exit(failCount > 0 ? 1 : 0);
