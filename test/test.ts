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
import { join, isAbsolute, sep } from "node:path";

import { PROBE_PREFIX, LANGUAGE_DIRS, TIER_ONE } from "../src/types.ts";
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
import { buildQuestion, buildExplainQuestion, questionId, readAnswer, readChoice } from "../src/questions.ts";
import { buildState, resolveSubject, renderOutline, capturedMetavariables, widenCommentCapture, OUTLINE_TEXT_LIMIT } from "../src/state.ts";
import { execFileSync } from "node:child_process";
import { listCommits, commitDiff, commitSubjects, commitFixtureSubjects, patchRepo, MAX_DIFF_CHARS } from "../src/commits.ts";
import { isTestFile, findTestFiles, relatedTestFiles, compactTest, pairTests, importsModule, MAX_RELATED_TESTS, TEST_EXCERPT_BUDGET } from "../src/paired.ts";
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
import { decide, gate, describe as describeFinding, blocks, looseFloor } from "../src/gate.ts";
import { Cache, verdictKey } from "../src/cache.ts";
import { parseUnifiedDiff, touchesChange, changedRanges, changedFilesUnder } from "../src/diff.ts";
import { widestGap, gapReport, fitCutoffs, labelFor, stabilityReport } from "../src/calibrate.ts";
import {
  buildSymbols,
  enclosingSymbol,
  moduleIdentity,
  emitRuleFile,
  ruleLanguages,
  astGrepRuleId,
  baseRuleId,
  toAstGrepRule,
} from "../src/scan.ts";
import { formatGithub, formatJson, formatPretty, silentRules, idleLanguages } from "../src/report.ts";
import { Jev, JevError, Pacer, API_KEY_VARS, DEFAULT_BASE_URL, fromEnv } from "../src/jev.ts";
import {
  applyConfig,
  findConfig,
  initialConfig,
  initialHook,
  initialPushHook,
  loadConfig,
  type Configurable,
} from "../src/config.ts";
import { parseIgnores, isIgnored, unknownIgnoredRules } from "../src/ignore.ts";
import { mergePasses } from "../src/run.ts";
import { discoverEvals, scoreEval, compareEvals, relocateLabels, runEval, readEvalRecord, draftsChanged, loadSuite, evalCorpus } from "../src/evals.ts";
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

test("rules: a rule under <lang>/<id>/rule.yml carries its language dir and may only name that dir's grammars", () => {
  // The layout convention: a path shaped `<lang>/<id>/rule.yml` under a
  // rules root gives the rule a language directory, and the directory
  // constrains the grammars -- which is what keeps a Rust matcher out of
  // the TypeScript file. Any other path is a rule file as before.
  const root = mkdtempSync(join(tmpdir(), "jev-lang-"));
  try {
    const write = (rel: string, text: string) => {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    write("typescript/a/rule.yml", "id: a\nlanguages: [TypeScript, Jsx]\nrule: { kind: x }\nask: q\n");
    write("rust/a/rule.yml", "id: a\nlanguage: Rust\nrule: { kind: y }\nask: q\n");
    write("rust/b/rule.yml", "id: b\nlanguages: [Rust, TypeScript]\nrule: { kind: y }\nask: q\n");
    write("typescript/c/rule.yml", "id: not-c\nlanguage: TypeScript\nrule: { kind: y }\nask: q\n");
    write("flat.yml", "id: flat\nlanguages: [Rust, TypeScript]\nrule: { kind: y }\nask: q\n");
    const { rules, errors } = loadRules([root]);
    const ids = rules.map((r) => `${r.languageDir}/${r.id}`).sort();
    assert.deepEqual(ids, ["null/flat", "rust/a", "typescript/a"], "same id under two dirs is two rules; a flat file has no dir");
    assert.equal(errors.length, 2, errors.join("\n"));
    assert.match(errors.find((e) => e.includes("b"))!, /TypeScript.*rust/, "a grammar outside its directory");
    assert.match(errors.find((e) => e.includes("not-c"))!, /directory.*c/, "the id must be the directory's name");
    assert.deepEqual(LANGUAGE_DIRS.typescript, ["TypeScript", "Tsx", "JavaScript", "Jsx"]);
    assert.deepEqual(TIER_ONE, ["typescript", "rust"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rules: the same id under two language dirs with different sentences is a drift warning, not an error", () => {
  const root = mkdtempSync(join(tmpdir(), "jev-drift-"));
  try {
    const write = (rel: string, text: string) => {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    write("typescript/a/rule.yml", "id: a\nlanguage: TypeScript\nrule: { kind: x }\nask: one\n");
    write("rust/a/rule.yml", "id: a\nlanguage: Rust\nrule: { kind: y }\nask: two\n");
    write("typescript/b/rule.yml", "id: b\nlanguage: TypeScript\nrule: { kind: x }\nask: same\nnote: n\n");
    write("rust/b/rule.yml", "id: b\nlanguage: Rust\nrule: { kind: y }\nask: same\nnote: n\n");
    const { rules, errors, warnings } = loadRules([root]);
    assert.equal(rules.length, 4);
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1, warnings.join("\n"));
    assert.match(warnings[0]!, /a.*drift|drift.*a/);
    assert.match(warnings[0]!, /ask/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rules: cutoffFor prefers lang/id over id, and both over the rule's own", () => {
  const rule = { ...scoreRule({ at: 1.5 }), languageDir: "rust" };
  assert.equal(cutoffFor(rule, {}), 1.5);
  assert.equal(cutoffFor(rule, { r: 2.5 }), 2.5, "the id applies to every language");
  assert.equal(cutoffFor(rule, { r: 2.5, "rust/r": 2.9 }), 2.9, "the language-qualified one wins");
  assert.equal(cutoffFor(rule, { "typescript/r": 2.9 }), 1.5, "another language's override is not this rule's");
});

test("rules: a commit rule has no matcher, only the Git grammar, and never reaches ast-grep", () => {
  // A commit is not an AST node. `subject: commit` is the one subject with
  // no ast-grep matcher: the runner builds its subjects from git instead.
  const { rule, error } = normalizeRule({
    id: "commit-message-describes-diff",
    language: "Git",
    subject: "commit",
    kind: "noul",
    ask: "The message claims something the diff does not do.",
    criteria: { true: "y", false: "n" },
  });
  assert.equal(error, undefined, error ?? "");
  assert.equal(rule!.subject, "commit");
  assert.deepEqual(rule!.languages, ["Git"]);
  assert.deepEqual(rule!.matcher, {}, "no matcher, and none required");
  assert.equal(rule!.state, "bare", "the diff is the state; there is no file to locate in");
  const bad = (over: Record<string, unknown>): string =>
    normalizeRule({ id: "c", language: "Git", subject: "commit", kind: "noul", ask: "a", criteria: { true: "y", false: "n" }, ...over }).error ?? "";
  assert.match(bad({ language: "TypeScript" }), /Git/, "a commit rule is Git only");
  assert.match(bad({ subject: "node" }), /commit/, "and Git is for commit rules only");
  assert.match(bad({ rule: { kind: "x" } }), /matcher/, "a matcher on a commit rule is a mistake, not ignored");
  assert.match(bad({ state: "located" }), /bare/, "and so is another arm");
  // ast-grep never sees it: a rule file with a commit rule and an ordinary
  // rule emits only the ordinary one, and Git is not a grammar to probe.
  const ordinary = scoreRule();
  const emitted = emitRuleFile([rule!, ordinary], ruleLanguages([rule!, ordinary]));
  assert.ok(!emitted.includes("Git"), "Git must not be emitted as a language");
  assert.ok(!emitted.includes("commit-message-describes-diff"));
  assert.deepEqual(ruleLanguages([rule!, ordinary]), ["TypeScript"]);
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

test("rules: a criterion may be a mapping of what / examples / not_for, and nothing else", () => {
  // The wire accepts any JSON as a criterion description, and a structured
  // one -- the defining sentence, a few examples, what the branch is NOT for
  // -- is what the SDK's own review workflow sends. Allowed here as a mapping
  // with exactly those keys, so a typo cannot silently reach the model as a
  // key it does not know.
  const structured = normalizeRule({
    id: "n",
    language: "Rust",
    kind: "noul",
    rule: { kind: "function_item" },
    ask: "a",
    criteria: {
      true: { what: "it does", examples: ["one", "two"], not_for: "code that merely mentions it" },
      false: "it does not",
    },
  });
  assert.equal(structured.error, undefined, structured.error ?? "");
  assert.deepEqual(structured.rule!.criteria, {
    true: { what: "it does", examples: ["one", "two"], not_for: "code that merely mentions it" },
    false: "it does not",
  });

  const bare = (criteria: unknown): string =>
    normalizeRule({ id: "n", language: "Rust", kind: "noul", rule: { kind: "function_item" }, ask: "a", criteria }).error ?? "";
  assert.match(bare({ true: { examples: ["x"] }, false: "n" }), /what/, "`what` is required");
  assert.match(bare({ true: { what: "" }, false: "n" }), /what/, "and non-empty");
  assert.match(bare({ true: { what: "y", examples: "x" }, false: "n" }), /examples/, "examples is a list");
  assert.match(bare({ true: { what: "y", examples: [] }, false: "n" }), /examples/, "and not an empty one");
  assert.match(bare({ true: { what: "y", counter: "x" }, false: "n" }), /counter/, "unknown keys are named");
  assert.match(bare({ true: ["a", "b"], false: "n" }), /criteria\.true/, "a list is neither shape");
});

test("rules: a structured criterion is part of the draft, and a string one hashes as before", () => {
  const plain = noulRule();
  // A string criterion must hash exactly as it always has, or every committed
  // cache of every noul rule misses on the day this lands.
  assert.equal(
    ruleTextHash(plain),
    ruleTextHash(noulRule({ criteria: { true: "it does", false: "it does not" } })),
  );
  const structured = noulRule({ criteria: { true: { what: "it does" }, false: "it does not" } });
  assert.notEqual(ruleTextHash(plain), ruleTextHash(structured), "the shape reaches the model");
  assert.notEqual(
    ruleTextHash(structured),
    ruleTextHash(noulRule({ criteria: { true: { what: "it does", examples: ["x"] }, false: "it does not" } })),
    "and so does an example",
  );
  // But not the spelling: key order in YAML is not a new draft.
  assert.equal(
    ruleTextHash(noulRule({ criteria: { true: { what: "y", not_for: "z" }, false: "n" } })),
    ruleTextHash(noulRule({ criteria: { true: { not_for: "z", what: "y" }, false: "n" } })),
  );
});

test("rules: `explain` is a closed mapping of at least two labels, and not part of the draft", () => {
  const r = scoreRule({ explain: { mutates: "It changes state the name does not mention", narrows: "It handles a narrower case" } });
  assert.deepEqual(r.explain, { mutates: "It changes state the name does not mention", narrows: "It handles a narrower case" });
  assert.equal(scoreRule().explain, null);
  // The explanation is asked AFTER the verdict, of findings only, so it never
  // touches what the verdict question looked like: adding one must not retire
  // a single cached verdict.
  assert.equal(ruleTextHash(scoreRule()), ruleTextHash(r));
  const bad = (explain: unknown): string =>
    normalizeRule({ id: "r", language: "TypeScript", rule: { kind: "x" }, ask: "a", explain }).error ?? "";
  assert.match(bad({ only: "one" }), /two/, "one option is not a choice");
  assert.match(bad({ a: "", b: "y" }), /explain\.a/, "a label needs a description");
  assert.match(bad(["a", "b"]), /mapping/, "a list has no labels");
  assert.match(bad({ a: 1, b: "y" }), /explain\.a/);
});

test("rules: `loose` is a floor under the cutoff, and not part of the draft", () => {
  assert.equal(noulRule({ at: 0.6, loose: 0.4 }).loose, 0.4);
  assert.equal(noulRule().loose, null);
  assert.equal(ruleTextHash(noulRule({ at: 0.6 })), ruleTextHash(noulRule({ at: 0.6, loose: 0.4 })), "a floor, like a cutoff, is free to move");
  const bad = (over: Record<string, unknown>): string =>
    normalizeRule({ id: "n", language: "Rust", kind: "noul", rule: { kind: "x" }, ask: "a", criteria: { true: "y", false: "n" }, at: 0.6, ...over }).error ?? "";
  assert.match(bad({ loose: 0.6 }), /below/, "equal to the cutoff is not a band");
  assert.match(bad({ loose: 0.7 }), /below/);
  assert.match(bad({ loose: -0.1 }), /between/);
  assert.match(bad({ loose: "half" }), /number/);
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

test("rules: every tier-one shipped rule has fixtures, an expect file and an accepted baseline", () => {
  // The bar a first-tier language is held to. A rule under any other
  // language directory may ship without a baseline and is listed as
  // uncalibrated; a rule under typescript/ or rust/ may not.
  const { rules, errors } = loadRules(["rules"]);
  assert.deepEqual(errors, []);
  for (const r of rules) {
    if (!r.languageDir || !(TIER_ONE as readonly string[]).includes(r.languageDir)) continue;
    const dir = join("rules", r.languageDir, r.id);
    assert.equal(r.source, join(dir, "rule.yml"), `${r.languageDir}/${r.id} lives where its identity says`);
    for (const need of ["fixtures", "expect.yml", "baseline.json"]) {
      assert.ok(existsSync(join(dir, need)), `${dir}/${need} is missing`);
    }
  }
  assert.ok(rules.some((r) => r.languageDir === "typescript") && rules.some((r) => r.languageDir === "rust"));
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

test("questions: a structured criterion reaches the wire as the mapping it was written as", () => {
  const rule = noulRule({
    criteria: { true: { what: "it does", examples: ["one"], not_for: "mentions" }, false: "it does not" },
  });
  const q = buildQuestion(rule, subjectOf({ rule }), "q0000");
  assert.equal(q.type, "noul");
  assert.deepEqual(q.criteria, {
    true: { what: "it does", examples: ["one"], not_for: "mentions" },
    false: "it does not",
  });
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

test("questions: an explain question is a choice over the rule's labels, about the same subject", () => {
  const rule = scoreRule({ explain: { mutates: "It changes state", narrows: "It handles a narrower case" } });
  const q = buildExplainQuestion(rule, subjectOf({ rule, captured: { NAME: "load" } }), "q0003");
  assert.equal(q.type, "choice");
  assert.deepEqual(q.criteria, { mutates: "It changes state", narrows: "It handles a narrower case" });
  assert.equal(q.instructions.subject, "q0003");
  assert.equal(q.instructions.statement, rule.ask, "it names the statement that was judged to hold");
  assert.deepEqual(q.instructions.matcher_captured, { NAME: "load" });
  assert.match(String(q.instructions.task), /judged to hold/, "and says the verdict is already in");
  // A choice answer reads back as its label and confidence; anything else is null.
  assert.deepEqual(
    readChoice({ q0003: { type: "choice", choice: "mutates", confidence: 0.8, probabilities: { mutates: 0.8, narrows: 0.2 } } }, "q0003"),
    { choice: "mutates", confidence: 0.8, probabilities: { mutates: 0.8, narrows: 0.2 } },
  );
  assert.equal(readChoice({ q0003: { type: "noul", noul: 0.9 } }, "q0003"), null);
  assert.equal(readChoice({}, "q0003"), null);
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

test("state: the paired arm carries the enclosing code and the related tests, never the file", () => {
  const args = {
    file: "src/a.ts",
    source: "SOURCE",
    entry: sampleEntry(),
    subjects: [subjectOf({ id: "q0000", nodeKind: "call", line: 3, endLine: 3, context: "function outer() { fetch(url) }", contextName: "outer" })],
    language: "TypeScript",
    tests: [{ path: "test/a.test.ts", via: "name" as const, code: 'it("outer throws on empty", () => { ... })' }],
  };
  const paired = buildState({ ...args, arm: "paired" });
  assert.equal(paired.source, undefined, "paired is not located: the file is not the evidence");
  assert.equal(paired.symbols, undefined);
  assert.equal(paired.file, "src/a.ts");
  assert.equal(paired.enclosing_code!.length, 1, "it carries what local carries");
  assert.deepEqual(paired.related_tests, [{ path: "test/a.test.ts", paired_by: "its name", code: 'it("outer throws on empty", () => { ... })' }]);
  assert.match(String(paired.note_on_related_tests), /excerpt/i, "and says the tests are excerpts, not whole files");

  // The other arms never carry tests, even when they are offered.
  for (const arm of ["bare", "local", "located", "graph", "full"] as StateArm[]) {
    assert.equal(buildState({ ...args, arm }).related_tests, undefined, `${arm} must not carry tests`);
  }
  // And a paired state with nothing to pair says so, rather than sending an empty list.
  const none = buildState({ ...args, tests: [], arm: "paired" });
  assert.equal(none.related_tests, undefined);
  assert.match(String(none.note_on_related_tests), /no test file/i);
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
  // `inner` sits inside `outer`'s byte range, so it is rendered under it.
  assert.match(out, /outer \(function[^\n]*\n    inner \(function/);
  assert.doesNotMatch(out, /private to this module/);
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

test("state: an outline nests a symbol under the symbol that contains it", () => {
  // Everything inside an `export` range is marked exported, which is right
  // for "is this symbol reachable from outside" and wrong for an outline
  // that lists "public API" flat: a 25k-line module showed 14 public items
  // of which 9 were methods of two classes and a `log` declared INSIDE
  // `createLogger`. To a rule asking whether one public function deviates
  // from its siblings, a nested helper is not a sibling. A contained symbol
  // is rendered indented under its container, in whichever section the
  // container is in.
  const sym = (name: string, role: string, start: number, end: number, exported: boolean) => ({
    name, role, start, end, line: start, endLine: end, text: `${role} ${name}() {}`, exported, isTest: false, calls: [], calledBy: [],
  });
  const out = renderOutline("src/logger.ts", {
    language: "TypeScript",
    imports: [],
    exportRanges: [],
    symbols: [
      sym("createLogger", "function", 0, 100, true),
      sym("log", "function", 10, 50, true),
      sym("Room", "class", 200, 400, true),
      sym("fetch", "method", 210, 300, true),
      sym("helper", "function", 500, 600, false),
      sym("inner", "function", 510, 550, false),
    ],
  });
  const lines = out.split("\n");
  const at = (name: string) => lines.find((l) => l.trim().startsWith(`${name} (`))!;
  assert.match(at("createLogger"), /^  createLogger/);
  assert.match(at("log"), /^    log \(function/, "a nested function is indented under its container");
  assert.match(at("fetch"), /^    fetch \(method/, "a method is indented under its class");
  assert.match(at("inner"), /^    inner \(function/);
  const publicSection = out.slice(out.indexOf("public API:"), out.indexOf("private to this module:"));
  assert.equal((publicSection.match(/^  \w/gm) ?? []).length, 2, "two top-level public items: createLogger and Room");
  assert.match(out, /private to this module:\n  helper \(function[^\n]*\n    inner/);
});

test("state: an outline is capped, exports first, and says what it left out", () => {
  // A 25k-line module in an unseen repository (950 symbols, 759 of them
  // functions) rendered a 127k-character outline -- 38k tokens, over the
  // state ceiling on its own -- and got no verdict at all: the server
  // refused it and halving the questions cannot shrink a single subject.
  // The cap keeps every export and drops private symbols from the end,
  // saying how many; an outline that cannot fit at all still reaches the
  // model, and one that fits is rendered exactly as before.
  const entry = sampleEntry();
  entry.symbols = [];
  for (let i = 0; i < 1500; i += 1) {
    entry.symbols.push({
      name: i < 20 ? `pub${i}` : `helper${i}`,
      role: "function",
      start: i * 100,
      end: i * 100 + 90,
      line: i * 4 + 1,
      endLine: i * 4 + 3,
      text: `function ${i < 20 ? `pub${i}` : `helper${i}`}(input: Input, options: Options): Promise<Result<Output>> {}`,
      exported: i < 20,
      isTest: false,
      calls: [],
      calledBy: [],
    });
  }
  const out = renderOutline("src/big.ts", entry);
  assert.ok(out.length <= OUTLINE_TEXT_LIMIT + 200, `outline should be capped near ${OUTLINE_TEXT_LIMIT}, got ${out.length}`);
  for (let i = 0; i < 20; i += 1) assert.match(out, new RegExp(`pub${i} \\(function`), "every export survives the cap");
  assert.match(out, /helper20 \(function/, "the first private symbols are kept");
  assert.match(out, /and \d+ more private symbols not shown/, "the cut is stated with its count");
  assert.doesNotMatch(out, /helper1499/, "the tail is what goes");
  assert.match(out, /imports:/, "imports are kept: they are short and the cheapest evidence of what a module is");
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

test("state: a captured line comment is widened to the run of comment lines it ends", () => {
  // tree-sitter makes every `//` line its own comment node, so `follows:
  // { kind: comment, pattern: $DOC }` captures only the LAST line of a
  // three-line comment -- the model was shown "// the loop after it." and
  // asked whether it was true of the code. The capture is widened to the
  // contiguous run of same-style comment lines above it, from the source.
  const src = [
    "function f() {",
    "  // Sort so the newest sessions are kept, because the eviction",
    "  // below drops from the front and must drop",
    "  // the oldest.",
    "  const ordered = sort(sessions);",
    "",
    "  // A lone line.",
    "  return ordered;",
    "}",
  ].join("\n");
  assert.equal(
    widenCommentCapture(src, 5, "// the oldest."),
    "// Sort so the newest sessions are kept, because the eviction\n// below drops from the front and must drop\n// the oldest.",
  );
  assert.equal(widenCommentCapture(src, 8, "// A lone line."), "// A lone line.", "a single line stays as it is");
  assert.equal(widenCommentCapture(src, 5, "const ordered"), "const ordered", "not a comment: untouched");
  // A blank line ends the run, and so does a line of code.
  assert.equal(widenCommentCapture(src, 8, "// A lone line."), "// A lone line.");
  // Rust doc comments are their own style; a `//` above a `///` run is not part of it.
  const rs = ["// a note", "/// Doc line one", "/// Doc line two", "pub fn f() {}"].join("\n");
  assert.equal(widenCommentCapture(rs, 4, "/// Doc line two"), "/// Doc line one\n/// Doc line two");
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

await testAsync("scan: Go types are named by their type_spec, and a parameter type is not an exported name", async () => {
  const { collectSubjects } = await import("../src/run.ts");
  const dir = mkdtempSync(join(tmpdir(), "jev-go-"));
  try {
    writeFileSync(join(dir, "a.go"), [
      "package x",
      "",
      "type User struct{ Name string }",
      "",
      "func (u User) Greet() string { return u.Name }",
      "",
      "func displayName(u User) string { return u.Name }",
      "",
    ].join("\n"));
    const rule = scoreRule({ language: "Go", rule: { kind: "function_declaration" }, state: "graph" });
    const { symbols } = await collectSubjects({ rules: [rule], paths: ["a.go"], cwd: dir });
    const entry = symbols.get("a.go")!;
    const byName = new Map(entry.symbols.map((s) => [s.name, s]));
    assert.ok(byName.has("User"), `the type is a named symbol: ${[...byName.keys()].join(", ")}`);
    assert.equal(byName.get("User")!.role, "type");
    assert.equal(byName.get("User")!.exported, true);
    assert.equal(byName.get("Greet")!.exported, true, "a capitalised method with a receiver");
    assert.equal(byName.get("displayName")!.exported, false, "a lower-case func with an exported parameter type is private");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("report: a language with no files is one idle line, not a list of dead matchers", () => {
  const ts = { ...scoreRule({ id: "a" }), languageDir: "typescript" };
  const tsSilent = { ...scoreRule({ id: "b" }), languageDir: "typescript" };
  const py1 = { ...scoreRule({ id: "a", language: "Python", rule: { kind: "x" } }), languageDir: "python" };
  const py2 = { ...scoreRule({ id: "b", language: "Python", rule: { kind: "x" } }), languageDir: "python" };
  const result = { rules: [ts, tsSilent, py1, py2], subjects: [subjectOf({ rule: ts })] };
  assert.deepEqual(idleLanguages(result), [{ language: "python", rules: 2 }]);
  assert.deepEqual(silentRules(result), ["typescript/b"], "the TypeScript matcher that missed is still named; Python is idle, not silent");
  const pretty = formatPretty({ ...result, findings: [], all: [], review: [], stats: { subjects: 1, reported: 0, missing: 0, unsure: 0, review: 0, byRule: {} } }, { color: false });
  assert.match(pretty, /no files for python \(2 rules\)/);
  assert.match(pretty, /1 rule\(s\) matched nothing: typescript\/b/);
});

// ---------------------------------------------------------------- paired

test("paired: a test file is recognised by its name or its directory, in the usual spellings", () => {
  for (const p of ["src/a.test.ts", "src/a.spec.tsx", "src/a_test.js", "test/a.ts", "tests/unit/a.mjs", "src/__tests__/a.ts", "spec/a_spec.rb", "pkg/cart_test.go", "pkg/test_cart.py"]) {
    assert.ok(isTestFile(p), `${p} is a test file`);
  }
  // Python's prefix and Go's suffix pair like the others.
  assert.deepEqual(relatedTestFiles("pkg/cart.py", ["pkg/test_cart.py", "pkg/test_other.py"]), ["pkg/test_cart.py"]);
  assert.deepEqual(relatedTestFiles("pkg/cart.go", ["pkg/cart_test.go", "pkg/other_test.go"]), ["pkg/cart_test.go"]);
  // A test in another language is never this file's test, whatever its name:
  // a Go module's cart.go once paired with test/fixtures/cookbook/cart.test.ts.
  assert.deepEqual(relatedTestFiles("pkg/cart.go", ["test/cart.test.ts", "test/cart.rs", "pkg/cart_test.go"]), ["pkg/cart_test.go"]);
  assert.deepEqual(relatedTestFiles("src/cart.ts", ["src/cart.test.js", "src/cart.test.tsx", "src/cart_test.go"]), ["src/cart.test.js", "src/cart.test.tsx"], "the ECMAScript family is one language");
  assert.ok(isTestFile("test/helpers.go", "func TestCart(t *testing.T) {}"), "a Go test opener");
  for (const p of ["src/a.ts", "src/testing.ts", "src/contest/a.ts", "src/latest.ts", "src/spec-parser.ts"]) {
    assert.ok(!isTestFile(p), `${p} is not`);
  }
  // Under a test directory, a file named like a test needs nothing more; any
  // other file is a test only if it contains one. `test/fixtures/cart.ts` is
  // a fixture, and pairing it as `cart.ts`'s test was measured to happen.
  assert.ok(isTestFile("test/fixtures/cart.ts", "export const cart = { items: [] };") === false, "a fixture under test/");
  assert.ok(isTestFile("test/cart.ts", 'test("adds", () => {});'), "a test under test/, named for its module");
  assert.ok(isTestFile("test/fixtures/cart.test.ts", "export const x = 1;"), "named as a test: always a test");
});

test("paired: related tests are ranked by stem, then directory, capped, and never the file itself", () => {
  const tests = [
    "test/other.test.ts",
    "src/cart/cart.test.ts",
    "src/cart/__tests__/cart.spec.ts",
    "test/cart.test.ts",
    "src/cart/checkout.test.ts",
    "test/cart/index.test.ts",
    "test/cart/pricing.test.ts",
  ];
  const ranked = relatedTestFiles("src/cart/cart.ts", tests);
  assert.deepEqual(ranked, ["src/cart/__tests__/cart.spec.ts", "src/cart/cart.test.ts", "test/cart.test.ts"],
    "name AND directory outrank name alone; ties break on path; a name match is required");
  assert.ok(!ranked.includes("src/cart/checkout.test.ts"), "same directory, other name: not this file's test");
  assert.ok(ranked.length <= MAX_RELATED_TESTS);
  const many = Array.from({ length: 9 }, (_, i) => `test/d${i}/cart.test.ts`);
  assert.equal(relatedTestFiles("src/cart.ts", many).length, MAX_RELATED_TESTS, "and the cap holds");
  // A test file that IMPORTS the module is related whatever it is called:
  // a repository with one test file for everything pairs on that.
  const sources = new Map([
    ["test/test.ts", 'import { total } from "../src/cart/cart.ts";\nit("x", () => total());'],
    ["test/other.test.ts", 'import { x } from "../src/other";'],
  ]);
  const byImport = relatedTestFiles("src/cart/cart.ts", ["test/test.ts", "test/other.test.ts"], (p) => sources.get(p) ?? "");
  assert.deepEqual(byImport, ["test/test.ts"]);
  // The name must be a whole dot- or underscore-separated segment of the
  // test's name: `cart.test.ts` and `cart_test.js` are about `cart`,
  // `cartography.test.ts` and `shopping-cart.test.ts` are not.
  assert.deepEqual(relatedTestFiles("src/cart.ts", ["test/cartography.test.ts", "test/cart_test.js", "test/shopping-cart.test.ts"]), ["test/cart_test.js"]);
  // A relative specifier is resolved from the test file and compared as a
  // path: `../src/report.ts` from `test/test.ts` is `src/report.ts` and not
  // any other `report.ts` in the tree.
  assert.ok(importsModule('import x from "./cart"', "src/cart/cart.ts", "src/cart/cart.test.ts"), "extension-free");
  assert.ok(importsModule("const { a } = require('../cart/cart.js')", "src/cart/cart.ts", "src/lib/x.test.ts"), "require, with extension");
  assert.ok(importsModule('import * as c from "../src/cart"', "src/cart/index.ts", "test/cart.test.ts"), "a directory import names index");
  assert.ok(importsModule('import { t } from "../../src/cart/cart.ts"', "src/cart/cart.ts", "test/unit/a.test.ts"), "two levels up");
  assert.ok(!importsModule('import { r } from "../src/report.ts"', "cases/report.ts", "test/test.ts"), "same name elsewhere is not this file");
  assert.ok(!importsModule('import { a } from "./cartography"', "src/cart/cart.ts", "src/cart/a.test.ts"), "a prefix is not the module");
  assert.ok(!importsModule('import { a } from "cart"', "src/cart/cart.ts", "src/cart/a.test.ts"), "a bare package is not a relative module");
  // A path-like alias (`src/cart`, `@/cart`) is matched as a suffix of the file's path.
  assert.ok(importsModule('import { a } from "src/cart/cart"', "src/cart/cart.ts", "test/a.test.ts"), "root-relative alias");
  assert.ok(importsModule('import { a } from "@/cart/cart"', "src/cart/cart.ts", "test/a.test.ts"), "@ alias");
  assert.ok(!importsModule('import { a } from "lib/cart/cart"', "src/cart/cart.ts", "test/a.test.ts"), "a different tree");
  // A module named by its directory pairs on the directory's name, and on
  // the mirrored `cart/index.test.ts`.
  const byDir = relatedTestFiles("src/cart/index.ts", tests);
  assert.deepEqual(byDir.slice(0, 3).sort(), ["src/cart/__tests__/cart.spec.ts", "src/cart/cart.test.ts", "test/cart/index.test.ts"]);
  // A test file is not paired with itself.
  assert.ok(!relatedTestFiles("src/cart/cart.test.ts", tests).includes("src/cart/cart.test.ts"));
});

test("paired: an excerpt keeps the lines that name the subject or open a test, with a little around each", () => {
  const content = [
    'import { parseCart } from "../src/cart";',   // 1 keyword: keeps 1-3
    "",                                            // 2
    "const fixture = {};",                         // 3
    "",                                            // 4
    'describe("cart", () => {',                    // 5 opener, no keyword near: not kept
    "  const c1 = 1;",                             // 6
    "  const c2 = 2;",                             // 7
    "  const c3 = 3;",                             // 8
    '  it("totals an empty cart", () => {',        // 9 opener of a test that never names the module
    "    expect(1).toBe(1);",                      // 10
    "  });",                                       // 11
    "  const c4 = 4;",                             // 12
    '  it("rejects an empty cart", () => {',       // 13 opener: the title above the keyword line
    "    const input = {};",                       // 14
    "    const again = input;",                    // 15
    "    expect(() => parseCart({})).toThrow();",  // 16 keyword: keeps 14-18 and 13
    "  });",                                       // 17
    "});",                                         // 18
  ].join("\n");
  const out = compactTest("test/cart.test.ts", content, ["parseCart"]);
  assert.equal(out.path, "test/cart.test.ts");
  assert.ok(out.code.includes("parseCart({})"), "the call that drives the failure path is kept");
  assert.ok(out.code.includes('it("rejects'), "and the title that claims it");
  assert.ok(out.code.includes("const input"), "with a little context around each");
  assert.ok(!out.code.includes('it("totals'), "a test that never names the module is not kept for its title");
  assert.ok(!out.code.includes("const c4"), "nor the filler between");
  assert.ok(out.code.includes("…"), "and the cut is marked");
  // Keywords are identifiers: `gate` is not `aggregate`.
  assert.equal(compactTest("t.ts", "aggregate();\nx;\nx;\nx;\nx;\ngate();", ["gate"]).code, "x;\nx;\ngate();");
  // A short test that names the module is kept WHOLE, from its opener to its
  // closing line: the assertion four lines below the call is the evidence.
  const whole = [
    'it("rejects an empty cart", async () => {',
    "  const result = await capturePayment(gatewayReturning({ status: 'succeeded' }));",
    "  const a = 1;",
    "  const b = 2;",
    "  const c = 3;",
    "  const d = 4;",
    "  assert.equal(result.ok, false);",
    "});",
    "",
    'it("unrelated", () => {',
    "  expect(1).toBe(1);",
    "});",
  ].join("\n");
  const kept = compactTest("t.ts", whole, ["capturePayment"]).code;
  assert.ok(kept.includes("assert.equal(result.ok, false);"), "the closing assertion survives");
  assert.ok(kept.includes("});"), "and the block's end");
  assert.ok(!kept.includes('it("unrelated"'), "but not the next test");
  // Nothing matches: the file is sent as it is rather than as nothing.
  assert.equal(compactTest("t.ts", "const a = 1;\nconst b = 2;", ["zzz"]).code, "const a = 1;\nconst b = 2;");
  // Long excerpts are cut from the middle, within the limit given.
  const long = Array.from({ length: 400 }, (_, i) => `it("case ${i}", () => parseCart(${i}));`).join("\n");
  const cut = compactTest("t.ts", long, ["parseCart"], 2000).code;
  assert.ok(cut.length <= 2000 + 8, `${cut.length} chars`);
  assert.ok(cut.startsWith('it("case 0"') && cut.trimEnd().endsWith("399));"), "both ends survive");
  // The default is the whole budget: one related file gets all of it.
  assert.ok(compactTest("t.ts", long, ["parseCart"]).code.length <= TEST_EXCERPT_BUDGET + 8);
});

test("paired: the walk finds test files under the paths and the conventional roots, and skips the usual junk", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-paired-"));
  try {
    for (const f of [
      "src/cart.ts", "src/cart.test.ts", "test/cart.test.ts", "tests/x.spec.js",
      "node_modules/dep/dep.test.ts", "dist/cart.test.js", ".git/a.test.ts", "coverage/a.test.ts",
    ]) {
      mkdirSync(join(dir, f, ".."), { recursive: true });
      writeFileSync(join(dir, f), "");
    }
    mkdirSync(join(dir, "test/fixtures"), { recursive: true });
    writeFileSync(join(dir, "test/fixtures/cart.ts"), "export const cart = {};");
    writeFileSync(join(dir, "test/helpers.ts"), 'export function run() { it("x", () => {}); }');
    const found = findTestFiles(["src"], dir).sort();
    assert.deepEqual(found, ["src/cart.test.ts", "test/cart.test.ts", "test/helpers.ts", "tests/x.spec.js"], "the fixture is not a test; the helper that opens tests is");
    // pairTests reads and compacts, keyed by the source file.
    writeFileSync(join(dir, "test/cart.test.ts"), 'it("totals", () => total([]));');
    writeFileSync(join(dir, "src/cart.test.ts"), "const setup = 1;");
    const paired = pairTests(["src/cart.ts", "src/nothing.ts", "src/empty.ts"], { roots: ["src"], cwd: dir, keywords: () => ["total"] });
    assert.deepEqual(paired.get("src/cart.ts")!.map((t) => t.path), ["src/cart.test.ts", "test/cart.test.ts"]);
    assert.deepEqual(paired.get("src/cart.ts")!.map((t) => t.via), ["name", "name"], "and says how each was paired");
    assert.equal(paired.get("src/cart.ts")![1]!.code, 'it("totals", () => total([]));');
    assert.equal(paired.get("src/cart.ts")![0]!.code, "const setup = 1;", "nothing matched: sent whole");
    assert.equal(paired.get("src/nothing.ts"), undefined, "no related tests: absent, so the runner can count it");
    // An empty test file is no evidence either.
    writeFileSync(join(dir, "src/empty.test.ts"), "");
    assert.equal(pairTests(["src/empty.ts"], { roots: ["src"], cwd: dir }).get("src/empty.ts"), undefined);
    // The budget is shared: two related files get half each.
    const big = Array.from({ length: 300 }, (_, i) => `it("t${i}", () => total(${i}));`).join("\n");
    writeFileSync(join(dir, "src/cart.test.ts"), big);
    writeFileSync(join(dir, "test/cart.test.ts"), big);
    const halves = pairTests(["src/cart.ts"], { roots: ["src"], cwd: dir, keywords: () => ["total"] }).get("src/cart.ts")!;
    assert.equal(halves.length, 2);
    for (const h of halves) assert.ok(h.code.length <= TEST_EXCERPT_BUDGET / 2 + 8, `${h.code.length} chars`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

await testAsync("run: a paired subject with no related test is dropped and counted, never asked", async () => {
  // A question about tests with no tests in the state is one the state cannot
  // answer; asking it anyway returns whatever the model thinks of untested
  // code in general. Dropping it silently would be the matcher failing
  // silently by another route, so the count is on the result.
  const { collectSubjects } = await import("../src/run.ts");
  const dir = mkdtempSync(join(tmpdir(), "jev-unpaired-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/tested.ts"), "export function a() { throw new Error('x'); }\n");
    writeFileSync(join(dir, "src/tested.test.ts"), "import { a } from './tested';\nit('a throws', () => { a(); });\n");
    writeFileSync(join(dir, "src/lonely.ts"), "export function b() { throw new Error('y'); }\n");
    const rule = noulRule({ id: "p", language: "TypeScript", state: "paired", rule: { kind: "function_declaration" } });
    const { subjects, tests, unpaired } = await collectSubjects({ rules: [rule], paths: ["src"], cwd: dir });
    assert.deepEqual(subjects.map((s) => s.file), ["src/tested.ts"]);
    assert.equal(tests!.get("src/tested.ts")!.length, 1);
    assert.deepEqual(unpaired, { subjects: 1, files: ["src/lonely.ts"] });
    // Under another arm the same rule asks about both, and pairs nothing.
    const located = await collectSubjects({ rules: [rule], paths: ["src"], cwd: dir, arm: "located" });
    assert.equal(located.subjects.length, 2, "the test file itself matches too? no: it is not a function_declaration file");
    assert.deepEqual(located.unpaired, { subjects: 0, files: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("run: --explain asks a second question of the findings only, and attaches the label", async () => {
  // jev-review's shape: a cheap screen, then a follow-up classification of
  // what came over the threshold. Here the matcher is the screen and the
  // verdict is the threshold; the follow-up is one choice per finding, sent
  // per batch with the same state, so nothing under the cutoff costs a token.
  const { run } = await import("../src/run.ts");
  const rule = scoreRule({
    id: "r",
    rule: { kind: "function_declaration" },
    explain: { mutates: "It changes state", narrows: "It handles a narrower case" },
  });
  const seen: Array<Record<string, { type: string }>> = [];
  const client = {
    model: "fake",
    servedModel: null,
    spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
    askSplitting: async (_state: unknown, questions: Record<string, { type: string }>) => {
      seen.push(questions);
      const answers: Record<string, unknown> = {};
      let i = 0;
      for (const [id, q] of Object.entries(questions)) {
        answers[id] =
          q.type === "choice"
            ? { type: "choice", choice: "narrows", confidence: 0.7, probabilities: { mutates: 0.3, narrows: 0.7 } }
            : { type: "score", score: i++ % 2 === 0 ? 3 : 1, confidence: 0.9 };
      }
      return { answers, usage: { input_tokens: 1 } };
    },
  };
  const result = await run({ rules: [rule], paths: ["rules/typescript/fn-name-promises/fixtures"], cachePath: null, client, explain: true });
  const verdictRounds = seen.filter((qs) => Object.values(qs).every((q) => q.type === "score"));
  const explainRounds = seen.filter((qs) => Object.values(qs).every((q) => q.type === "choice"));
  assert.ok(verdictRounds.length > 0 && explainRounds.length > 0, "two kinds of request, never mixed");
  assert.equal(
    explainRounds.reduce((n, qs) => n + Object.keys(qs).length, 0),
    result.findings.length,
    "exactly one explain question per reported finding",
  );
  assert.ok(result.findings.length > 0 && result.findings.length < result.all.length, "the fake put only some over the cutoff");
  for (const f of result.findings) assert.deepEqual(f.explanation, { choice: "narrows", confidence: 0.7 });
  for (const f of result.all.filter((f) => !f.reported)) assert.equal(f.explanation, undefined, "nothing under the cutoff is explained");
  // And the explanation reaches every format.
  assert.match(formatPretty(result, { color: false }), /why: narrows \(0\.70\)/);
  assert.match(formatGithub(result), /why: narrows/);
  assert.equal(JSON.parse(formatJson(result)).findings[0].explanation.choice, "narrows");
  // Without the flag nothing is asked twice, whatever the rule declares.
  seen.length = 0;
  const plain = await run({ rules: [rule], paths: ["rules/typescript/fn-name-promises/fixtures"], cachePath: null, client });
  assert.equal(seen.filter((qs) => Object.values(qs).some((q) => q.type === "choice")).length, 0);
  assert.ok(plain.findings.every((f) => f.explanation === undefined));
});

await testAsync("run: --loose reaches every format as a section of its own, and costs no request", async () => {
  const { run } = await import("../src/run.ts");
  const rule = scoreRule({ id: "r", rule: { kind: "function_declaration" }, at: 2.0 });
  let calls = 0;
  const client = {
    model: "fake",
    servedModel: null,
    spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
    askSplitting: async (_state: unknown, questions: Record<string, unknown>) => {
      calls += 1;
      const answers: Record<string, unknown> = {};
      let i = 0;
      // A spread of answers: some over 2.0, some in [1.0, 2.0), some under.
      for (const id of Object.keys(questions)) answers[id] = { type: "score", score: [2.5, 1.5, 0.5][i++ % 3], confidence: 0.9 };
      return { answers, usage: { input_tokens: 1 } };
    },
  };
  const opts = { rules: [rule], paths: ["rules/typescript/fn-name-promises/fixtures"], cachePath: null, client };
  const loose = await run({ ...opts, loose: Infinity });
  const before = calls;
  const tight = await run(opts);
  assert.equal(calls, before * 2, "the band is a second line on the same answers, not a second request");
  assert.equal(loose.findings.length, tight.findings.length, "findings are identical");
  assert.ok(loose.review.length > 0 && tight.review.length === 0);
  assert.ok(loose.review.every((f) => f.value! >= 1.0 && f.value! < 2.0));
  const pretty = formatPretty(loose, { color: false });
  assert.match(pretty, new RegExp(`${loose.review.length} subject\\(s\\) under a cutoff but over its loose floor`));
  assert.match(formatGithub(loose), /::notice .*loose/);
  const json = JSON.parse(formatJson(loose));
  assert.equal(json.review.length, loose.review.length);
  assert.equal(json.review[0].messageId, "review");
  assert.equal(json.findings.length, loose.findings.length, "and never mixed into the findings");
});

// ---------------------------------------------------------------- commits

/** A throwaway repository with commits made by `steps`, for the commit tests. */
function tempRepo(steps: Array<{ message: string; files: Record<string, string> }>): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-commits-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" } }).toString();
  git("init", "-q", "-b", "main");
  for (const step of steps) {
    for (const [f, text] of Object.entries(step.files)) {
      mkdirSync(join(dir, f, ".."), { recursive: true });
      writeFileSync(join(dir, f), text);
    }
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", step.message);
  }
  return dir;
}

const commitRule = (over: Record<string, unknown> = {}): Rule =>
  normalizeRule({
    id: "commit-message-describes-diff",
    language: "Git",
    subject: "commit",
    kind: "noul",
    ask: "The message claims something the diff does not do.",
    criteria: { true: "y", false: "n" },
    at: 0.5,
    ...over,
  }).rule!;

test("commits: a range lists its commits oldest first, with subject, body and parents", () => {
  const dir = tempRepo([
    { message: "Add cart", files: { "cart.ts": "export const cart = 1;\n" } },
    { message: "Fix the total\n\nIt was off by one.", files: { "cart.ts": "export const cart = 2;\n" } },
  ]);
  try {
    const commits = listCommits("HEAD", dir);
    assert.equal(commits.length, 2);
    assert.equal(commits[0]!.subject, "Add cart", "oldest first, so a review reads in order");
    assert.equal(commits[1]!.subject, "Fix the total");
    assert.equal(commits[1]!.message, "Fix the total\n\nIt was off by one.");
    assert.equal(commits[0]!.parents.length, 0);
    assert.equal(commits[1]!.parents.length, 1);
    assert.match(commits[1]!.sha, /^[0-9a-f]{40}$/);
    assert.deepEqual(listCommits(`${commits[0]!.sha}..HEAD`, dir).map((c) => c.subject), ["Fix the total"]);
    // The diff: files touched, a stat, the patch, and whether it was cut.
    const d = commitDiff(commits[1]!.sha, dir);
    assert.deepEqual(d.files, ["cart.ts"]);
    assert.match(d.stat, /cart\.ts/);
    assert.match(d.diff, /-export const cart = 1;\n\+export const cart = 2;/);
    assert.equal(d.truncated, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commits: a diff over the budget keeps the stat and the first hunks and says so", () => {
  const big = Array.from({ length: 4000 }, (_, i) => `line ${i} of a very long file that will not fit in one state`).join("\n");
  const dir = tempRepo([{ message: "Add a big file", files: { "big.txt": big, "small.txt": "x\n" } }]);
  try {
    const [c] = listCommits("HEAD", dir);
    const d = commitDiff(c!.sha, dir);
    assert.equal(d.truncated, true);
    assert.ok(d.diff.length <= MAX_DIFF_CHARS + 200, `${d.diff.length} chars`);
    assert.match(d.stat, /big\.txt/);
    assert.match(d.stat, /small\.txt/, "the stat still names every file");
    assert.ok(d.diff.startsWith("diff --git"), "and the diff still starts at the top");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commits: subjects are one per commit per commit rule; merges are skipped and counted", () => {
  const dir = tempRepo([
    { message: "Add cart", files: { "cart.ts": "a\n" } },
    { message: "Fix cart", files: { "cart.ts": "b\n" } },
  ]);
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" }, stdio: ["ignore", "pipe", "pipe"] }).toString();
    git("checkout", "-q", "-b", "side", "HEAD~1");
    writeFileSync(join(dir, "side.ts"), "s\n");
    git("add", "-A");
    git("commit", "-q", "-m", "Add side");
    git("checkout", "-q", "main");
    git("merge", "-q", "--no-ff", "-m", "Merge side", "side");
    const rule = commitRule();
    const ordinary = scoreRule();
    const { subjects, skippedMerges, commits } = commitSubjects([rule, ordinary], "HEAD", dir);
    assert.equal(commits, 4, "four commits reachable");
    assert.equal(skippedMerges, 1, "the merge is not judged: its diff is its parents'");
    assert.equal(subjects.length, 3, "one per non-merge commit for the one commit rule; the ordinary rule makes none");
    const fix = subjects.find((s) => s.text.startsWith("Fix cart"))!;
    assert.equal(fix.rule.id, "commit-message-describes-diff");
    assert.match(fix.file, /^[0-9a-f]{40}$/, "the finding's file is the sha");
    assert.equal(fix.line, 1);
    assert.equal(fix.arm, "bare");
    assert.equal(fix.language, "Git");
    assert.equal(fix.nodeKind, "commit");
    assert.deepEqual(fix.captured, { SUBJECT: "Fix cart" });
    assert.ok(fix.commit && fix.commit.diff.includes("-a\n+b"), "the diff travels with the subject");
    // The state carries the message as the subject and the diff as the evidence.
    const [batch] = planBatches([fix]);
    assert.equal(batch!.state.message, "Fix cart");
    assert.equal(batch!.state.diff, fix.commit!.diff);
    assert.deepEqual(batch!.state.files, ["cart.ts"]);
    assert.match(String(batch!.state.reviewing), /commit/);
    const q = batch!.questions[batch!.subjects[0]!.id!]!;
    assert.equal(q.instructions.message, "Fix cart", "the question names the message, not `code`");
    assert.equal(q.instructions.code, undefined);
    assert.equal(q.instructions.matched_because, undefined, "no matcher, so no loose-matcher caveat");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("run: commits mode judges a range with the commit rules only, and every format names the commit", async () => {
  const { run } = await import("../src/run.ts");
  const dir = tempRepo([
    { message: "Add cart", files: { "cart.ts": "a\n" } },
    { message: "Remove the cart entirely", files: { "cart.ts": "b\n" } },
  ]);
  try {
    const rule = commitRule();
    const ordinary = scoreRule({ rule: { kind: "function_declaration" } });
    const seen: unknown[] = [];
    const client = {
      model: "fake",
      servedModel: null,
      spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
      askSplitting: async (state: { message?: string }, questions: Record<string, unknown>) => {
        seen.push(state);
        const answers: Record<string, unknown> = {};
        for (const id of Object.keys(questions)) answers[id] = { type: "noul", noul: state.message?.startsWith("Remove") ? 0.9 : 0.1 };
        return { answers, usage: { input_tokens: 1 } };
      },
    };
    const result = await run({ rules: [rule, ordinary], paths: [], commits: { range: "HEAD" }, cwd: dir, cachePath: null, client });
    assert.equal(result.subjects.length, 2, "two commits, one commit rule; the ordinary rule made no subject");
    assert.equal(seen.length, 2, "one request per commit");
    assert.equal(result.findings.length, 1);
    const [f] = result.findings;
    assert.match(f!.file, /^[0-9a-f]{40}$/);
    assert.equal(f!.line, 1);
    const pretty = formatPretty(result, { color: false });
    assert.match(pretty, new RegExp(`${f!.file.slice(0, 8)}  "Remove the cart entirely"`), "the commit is named by short sha and subject line");
    assert.match(formatGithub(result), /title=commit-message-describes-diff/);
    assert.equal(JSON.parse(formatJson(result)).findings[0].commit.subject, "Remove the cart entirely");
    // Dry run lists the commits and asks nothing.
    const dry = await run({ rules: [rule], paths: [], commits: { range: "HEAD" }, cwd: dir, cachePath: null, client, dryRun: true });
    assert.equal(dry.subjects.length, 2);
    assert.equal(seen.length, 2, "nothing more was asked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
    paths: ["rules/typescript/fn-name-promises/fixtures"],
    cachePath: null,
    retry: 3,
    concurrency: 1,
    client,
  });
  assert.ok(result.subjects.length > 3, "the cases must produce several batches");
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

await testAsync("jev: a 429 is waited out at a lower rate and the request goes again, not lost", async () => {
  // The server rate-limits with a bare 429 -- no retry-after, no ratelimit
  // headers -- on input tokens, not requests. The client mirrors the bucket
  // and paces itself; a 429 means the mirror was optimistic: it empties,
  // the rate drops, and the request that met it waits and goes again. It is
  // not a failure of the request and does not spend the retry budget.
  const pacer = new Pacer(1_000_000, 1_000_000);
  const jev = new Jev({ apiKey: "k", retries: 0, pacer, fetch: fakeFetch, rateLimitWaitMs: 1 });
  let calls = 0;
  async function fakeFetch(): Promise<Response> {
    calls += 1;
    if (calls <= 3) {
      return new Response('{"detail":{"error_type":"api_usage_error","message":"Rate limit exceeded."}}', { status: 429 });
    }
    return new Response(JSON.stringify({ answers: { q0000: { type: "noul", noul: 0.5 } }, usage: { input_tokens: 1 } }), { status: 200 });
  }
  const q = { q0000: { type: "noul", instructions: {}, criteria: { true: "y", false: "n" } } } as Record<string, Question>;
  const res = await jev.askSplitting({}, q);
  assert.ok(res.answers?.q0000, "the verdict came back after the 429s");
  assert.equal(jev.rateLimited, 3, "each refusal is counted");
  assert.equal(jev.retried, 0, "a 429 does not spend the retry budget");
  assert.ok(pacer.rate < 1_000_000 * 0.75 ** 2, `the rate dropped a quarter per 429, got ${pacer.rate}`);
  assert.ok(pacer.available() < 500_000, "the mirror was emptied and has only begun to refill");
});

test("jev: the pacer charges the estimate, refills at its rate, and makes a request wait", () => {
  const t0 = 1_000_000;
  const pacer = new Pacer(100_000, 300_000, t0);
  assert.equal(pacer.delay(250_000, t0), 0, "within the burst: no wait");
  assert.equal(pacer.delay(300_000, t0), 0);
  assert.equal(pacer.delay(2_000_000, t0), 0, "a request larger than the burst goes when the bucket is full, not never");
  // Charge 250k: 50k left; 100k more is 500 ms away at 100k/s.
  pacer.settle(0, 250_000);
  assert.equal(pacer.delay(100_000, t0), 500);
  assert.equal(pacer.delay(100_000, t0 + 500), 0);
  assert.equal(pacer.delay(100_000, t0 + 250), 250);
  // The server counted more than the estimate: the difference is charged.
  pacer.settle(1_000, 21_000);
  assert.equal(pacer.delay(100_000, t0 + 500), 200);
  // A 429 empties the mirror and slows the refill.
  pacer.throttled(t0 + 500);
  assert.equal(pacer.rate, 75_000);
  assert.equal(pacer.available(t0 + 500), 0);
  assert.equal(pacer.delay(75_000, t0 + 500), 1000);
});

await testAsync("jev: a 429 that never clears is given up on, with the server's message", async () => {
  const jev = new Jev({ apiKey: "k", retries: 0, fetch: always429, rateLimitWaitMs: 1, rateLimitRetries: 3 });
  let calls = 0;
  async function always429(): Promise<Response> {
    calls += 1;
    return new Response('{"detail":{"message":"Rate limit exceeded."}}', { status: 429 });
  }
  const q = { q0000: { type: "noul", instructions: {}, criteria: { true: "y", false: "n" } } } as Record<string, Question>;
  await assert.rejects(() => jev.ask({}, q), /HTTP 429/);
  assert.equal(calls, 4, "one attempt plus rateLimitRetries");
});

await testAsync("jev: usage is priced at the published input rate", async () => {
  const jev = new Jev({ apiKey: "k" });
  jev.inputTokens = 1_000_000;
  assert.ok(Math.abs(jev.usd - 0.042) < 1e-9);
});

// ------------------------------------------------------------------ evals

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

const evalRule = (id: string, at: number) => noulRule({ id, at });
const answer = (rule: string, line: number, value: number) => ({
  rule, file: "rules/a/evals/cases/x.ts", line, endLine: line, kind: "noul" as const, value, confidence: null,
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
  const same = compareEvals(before, before, { draftChanged: false });
  assert.equal(same.ok, true);
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

// ----------------------------------------------------------------- wiring

await testAsync("end to end: every shipped rule finds subjects in its own evals, and every labelled case is one", async () => {
  // The one test that touches ast-grep over the shipped rules. It asserts
  // the MATCHING and the plumbing, never a verdict: no request is made, so
  // there is no answer to assert. That the rules separate their classes is
  // what `jev-lint eval` measures, against each rule's evals/baseline.json.
  const { collectSubjects } = await import("../src/run.ts");
  const { rules } = loadRules(["rules"]);
  const { paths, labels } = evalCorpus(["rules"]);
  assert.ok(paths.length >= 15, `expected a cases directory per rule, got ${paths.length}`);
  const { subjects: fromFiles } = await collectSubjects({ rules, paths });
  // A commit suite's fixtures are patches, judged as commits of a throwaway
  // repository and named by their patch files.
  const fromPatches = paths.filter((p) => p.includes(`${sep}git${sep}`) || p.includes("/git/")).flatMap((p) => commitFixtureSubjects(rules, p));
  const subjects = [...fromFiles, ...fromPatches];
  assert.ok(subjects.length > 50, `expected the evals to produce subjects, got ${subjects.length}`);

  const byRule = new Map();
  for (const s of subjects) byRule.set(s.rule.id, (byRule.get(s.rule.id) ?? 0) + 1);
  for (const r of rules) {
    assert.ok(byRule.get(r.id) > 0, `${r.id} matched nothing in its evals`);
  }
  // A label that no subject sits on is a label about nothing -- a line that
  // moved, or a case the matcher does not reach -- and it would silently
  // count as a miss or as nothing at all.
  const at = new Set(subjects.map((s) => `${s.rule.id}\u0000${s.file}\u0000${s.line}`));
  const orphans: string[] = [];
  for (const [file, list] of Object.entries(labels)) {
    if (file.startsWith("$") || !Array.isArray(list)) continue;
    for (const l of list) {
      if (!l.rule) continue;
      const w = l.window ?? 3;
      const hit = [...at].some((k) => {
        const [rule, f, line] = k.split("\u0000");
        return rule === l.rule && f === file && Math.abs(Number(line) - l.line) <= w;
      });
      if (!hit) orphans.push(`${file}:${l.line} ${l.rule}`);
    }
  }
  assert.deepEqual(orphans, [], "every label must sit on a subject its rule produces");

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

await testAsync("end to end: a statement inside a test callback promotes to the test, named by its title", async () => {
  // A `test("...", () => { ... })` body is an arrow function passed to a call:
  // no declarator names it, so it was not a container, and a `subject:
  // enclosing` rule matching a statement inside it could promote to nothing.
  // The model then judged one line and its comment -- which is why the
  // comment-describes-block rule read every test preamble in this repository
  // as a false claim about the first `const` under it. The test call is a
  // container now, named by its title, with role `test`.
  const { collectSubjects } = await import("../src/run.ts");
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-test-"));
  try {
    writeFileSync(
      join(dir, "a.test.ts"),
      [
        'import { test, expect } from "vitest";',
        "",
        'test("keeps the order", () => {',
        "  // Sorting must not touch the input: a later test",
        "  // relies on the original order.",
        "  const before = [3, 1, 2];",
        "  expect(sort(before)).toEqual([1, 2, 3]);",
        "});",
        "",
        'describe("group", () => {',
        '  it("nested", async () => {',
        "    // Nested too.",
        "    const x = await load();",
        "    expect(x).toBe(1);",
        "  });",
        "});",
      ].join("\n"),
    );
    const rule = scoreRule({
      id: "b",
      subject: "enclosing",
      rule: { kind: "lexical_declaration", follows: { kind: "comment", pattern: "$DOC" } },
    });
    const { subjects, symbols } = await collectSubjects({ rules: [rule], paths: [dir] });
    assert.equal(subjects.length, 2);
    const [outer, inner] = subjects.sort((a, b) => a.line - b.line);
    assert.equal(outer!.promoted, true);
    assert.equal(outer!.nodeKind, "test");
    assert.ok(outer!.text.startsWith('test("keeps the order"'), "promoted to the whole test call, title included");
    assert.ok(outer!.text.includes("expect(sort(before))"), "the whole body, not the one statement");
    assert.ok(inner!.text.startsWith('it("nested"'), "the narrowest container wins: the it, not the describe");
    assert.ok(!inner!.text.includes("keeps the order"));
    // And the captured comment is the whole comment, not its last line.
    assert.equal(outer!.captured.DOC, "// Sorting must not touch the input: a later test\n// relies on the original order.");
    const entry = [...symbols.values()][0]!;
    assert.ok(entry.symbols.some((s) => s.role === "test" && s.name === "keeps the order" && s.isTest));
    assert.ok(entry.symbols.some((s) => s.role === "suite" && s.name === "group"));
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

await testAsync("config: the pre-push hook judges the commits about to be pushed, and steps aside without an upstream", async () => {
  const { execFileSync } = await import("node:child_process");
  const hook = initialPushHook();
  assert.ok(hook.startsWith("#!/bin/sh\n"));
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-hook-"));
  try {
    writeFileSync(join(dir, "pre-push"), hook);
    execFileSync("sh", ["-n", join(dir, "pre-push")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.match(hook, /jev-lint commits/, "it judges commits, not files");
  assert.match(hook, /@\{upstream\}/, "what is not yet pushed");
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
