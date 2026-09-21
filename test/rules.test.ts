import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { decide, describe as describeFinding } from "../src/gate.ts";
import { buildQuestion } from "../src/questions.ts";
import { normalizeRule, loadRules, cutoffFor, ruleTextHash, normalizeLanguage, ruleSources, USER_RULES_DIR, applyRuleSettings, languageDirGrammars, undeclared, shippedRulesPath, selectRules, DEFAULT_SCORE_AT, scaleOf } from "../src/rules.ts";
import { SHIPPED_CUSTOM_LANGUAGES } from "../src/types.ts";
import { emitRuleFile, ruleLanguages } from "../src/scan.ts";
import { explain } from "../src/schedule.ts";
import { PROBE_PREFIX, LANGUAGE_DIRS, TIER_ONE } from "../src/types.ts";
import { scoreRule, noulRule, subjectOf } from "./builders.ts";
import { test, testAsync } from "./harness.ts";

test("rules: the sources are the shipped packs and, when it exists, .jev-lint/rules/ -- never a bare ./rules", () => {
  // A fresh install used to exit 2 with "no usable rules found in rules":
  // the default was the literal `rules`, and the packs live in
  // `node_modules/jev-lint/rules`. Since 0.5 a project's own rules live in
  // `.jev-lint/rules/` and ADD to the shipped set -- they are selected by
  // id in the config like any other -- and a `./rules` directory is no
  // longer anything to this tool.
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-rules-"));
  try {
    const shipped = ruleSources(dir);
    assert.equal(shipped.length, 1);
    assert.ok(isAbsolute(shipped[0]!) && existsSync(shipped[0]!), `${shipped[0]} must be the package's own rules`);
    assert.ok(loadRules(shipped).rules.length > 0, "and must actually load");
    mkdirSync(join(dir, "rules"));
    assert.equal(ruleSources(dir).length, 1, "./rules is not a source");
    mkdirSync(join(dir, ".jev-lint", "rules"), { recursive: true });
    const both = ruleSources(dir);
    assert.equal(both.length, 2);
    assert.equal(both[1], join(dir, USER_RULES_DIR));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rules: a declared language is one a rule may name, and an undeclared one is still unknown", () => {
  const elm = { elm: { libraryPath: "/opt/elm.so", extensions: ["elm"] } };
  assert.equal(normalizeLanguage("elm"), null, "not built in, and the package ships no elm rule");
  assert.equal(normalizeLanguage("elm", elm), "elm");
  assert.equal(normalizeLanguage("Elm", elm), "elm", "named as the declaration spells it: that is what ast-grep matches on");
  assert.equal(normalizeLanguage("purescript", elm), null, "declaring one language does not open the door to another");
  assert.equal(normalizeLanguage("Rust", elm), "Rust", "and the built-ins are unaffected");
  // A rule may name it, and a rule directory may be called it.
  const { rule, error } = normalizeRule({ id: "m", language: "elm", rule: { kind: "function_declaration_left" }, ask: "a." }, "rule", elm);
  assert.equal(error, undefined, error ?? "");
  assert.deepEqual(rule!.languages, ["elm"]);
  assert.match(normalizeRule({ id: "m", language: "elm", rule: { kind: "x" }, ask: "a." }).error!, /unknown language/);
  assert.deepEqual(languageDirGrammars("elm", elm), ["elm"]);
  assert.equal(languageDirGrammars("elm"), null);
});

test("rules: the config's `rules:` selects and overrides, and names nothing it cannot find", () => {
  const ts = normalizeRule({ id: "a", language: "TypeScript", rule: { kind: "x" }, ask: "a" }).rule!;
  const rs = normalizeRule({ id: "a", language: "Rust", rule: { kind: "x" }, ask: "a" }).rule!;
  const b = normalizeRule({ id: "b", language: "TypeScript", rule: { kind: "x" }, ask: "b", severity: "info" }).rule!;
  const loaded = [{ ...ts, languageDir: "typescript" }, { ...rs, languageDir: "rust" }, { ...b, languageDir: "typescript" }];
  // `a: on` is both languages; `rust/a: off` is one of them, and wins over the bare id.
  const one = applyRuleSettings(loaded, { a: { enabled: true }, "rust/a": { enabled: false }, b: { enabled: true, severity: "error", at: 2.5, loose: 1 } });
  assert.deepEqual(one.errors, []);
  assert.deepEqual(one.rules.map((r) => `${r.languageDir}/${r.id}`), ["typescript/a", "typescript/b"]);
  const overridden = one.rules.find((r) => r.id === "b")!;
  assert.equal(overridden.severity, "error");
  assert.equal(overridden.at, 2.5);
  assert.equal(overridden.loose, 1);
  assert.equal(one.rules.find((r) => r.id === "a")!.severity, "warning", "`on` keeps the rule's own");
  // A rule the config does not name does not run.
  assert.deepEqual(applyRuleSettings(loaded, { b: { enabled: true } }).rules.map((r) => r.id), ["b"]);
  // A name that matches nothing is an error, as ESLint's "definition not found" is.
  const missing = applyRuleSettings(loaded, { c: { enabled: true }, "python/a": { enabled: false } });
  assert.equal(missing.errors.length, 2);
  assert.match(missing.errors[0]!, /`c`/);
  assert.match(missing.errors[1]!, /`python\/a`/);
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
  assert.equal(rule!.matcher, null, "no matcher, and none required");
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

test("rules: `run` selects one shipped rule by id, in every language or one, or the rules of a file", () => {
  // `jev-lint run fn-name-promises src`: the shipped rule, whatever the
  // project's own rules/ holds, in every language that has it; with a
  // language prefix, in that one. `--file` names a file instead, and the
  // id then picks one rule out of it.
  const shipped = shippedRulesPath()!;
  assert.ok(existsSync(shipped));
  const every = selectRules({ id: "fn-name-promises", shipped, projectRules: [] });
  assert.deepEqual(every.errors, []);
  assert.deepEqual(every.rules.map((r) => r.languageDir).sort(), ["go", "moonbit", "python", "rust", "typescript"]);
  const one = selectRules({ id: "rust/fn-name-promises", shipped, projectRules: [] });
  assert.deepEqual(one.rules.map((r) => `${r.languageDir}/${r.id}`), ["rust/fn-name-promises"]);
  // Unknown: an error that names the nearest ids, never an empty run.
  const missing = selectRules({ id: "fn-name", shipped, projectRules: [] });
  assert.equal(missing.rules.length, 0);
  assert.match(missing.errors[0]!, /no shipped rule.*fn-name/);
  assert.match(missing.errors[0]!, /fn-name-promises/, "the nearest ids are offered");
  // A project's own rule is found when the shipped set has no such id.
  const dir = mkdtempSync(join(tmpdir(), "jev-run-"));
  try {
    writeFileSync(join(dir, "mine.yml"), "- id: mine\n  language: TypeScript\n  rule: { kind: x }\n  ask: q\n- id: other\n  language: TypeScript\n  rule: { kind: y }\n  ask: q\n");
    const own = selectRules({ id: "mine", shipped, projectRules: [dir] });
    assert.deepEqual(own.rules.map((r) => r.id), ["mine"]);
    // --file: the file's rules, all of them or the named one.
    const file = selectRules({ file: join(dir, "mine.yml"), shipped, projectRules: [] });
    assert.deepEqual(file.rules.map((r) => r.id), ["mine", "other"]);
    const picked = selectRules({ file: join(dir, "mine.yml"), id: "other", shipped, projectRules: [] });
    assert.deepEqual(picked.rules.map((r) => r.id), ["other"]);
    assert.match(selectRules({ file: join(dir, "mine.yml"), id: "nope", shipped, projectRules: [] }).errors[0]!, /nope.*mine\.yml/);
    assert.match(selectRules({ file: join(dir, "missing.yml"), shipped, projectRules: [] }).errors[0]!, /no such file/);
  } finally {
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

test("rules: a score rule may carry its own ordered rubric as `levels`, and its cutoff scales with it", () => {
  // The shared four-level scale is the default. A rule about prose --
  // JevSlop's eight axes are five-level rubrics -- says its own, ordered
  // from clean to worst, and `at` then runs 0..levels-1.
  const five = ["Almost none.", "Occasional.", "Moderate.", "Frequent.", "Dominates the writing."];
  const r = scoreRule({ levels: five, at: 3.5 });
  assert.deepEqual(r.levels, five);
  assert.equal(scaleOf(r), 4);
  assert.equal(scaleOf(scoreRule()), 3, "the shared scale is 0..3");
  assert.equal(scaleOf(noulRule()), 1);
  const q = buildQuestion(r, subjectOf({ rule: r }), "q0000");
  assert.deepEqual(q.criteria, five, "the rubric reaches the wire as the criteria");
  assert.notEqual(ruleTextHash(r), ruleTextHash(scoreRule({ levels: five.slice(0, 4), at: 2 })), "the rubric is part of the draft");
  const bad = (over: Record<string, unknown>): string =>
    normalizeRule({ id: "s", language: "TypeScript", rule: { kind: "x" }, ask: "a", ...over }).error ?? "";
  assert.match(bad({ levels: ["one"] }), /two/, "one level is not a scale");
  assert.match(bad({ levels: five, at: 4.5 }), /between 0 and 4/);
  assert.match(bad({ kind: "noul", criteria: { true: "y", false: "n" }, levels: five }), /score/, "levels are a score rule's");
  assert.match(bad({ levels: ["a", ""] }), /levels/);
  // A finding on a custom rubric names its level by number and its scale.
  const f = decide(subjectOf({ rule: r }), { value: 3.6, confidence: 0.8, kind: "score" });
  assert.equal(f.level, "level-4");
  assert.equal(f.scale, 4);
  assert.match(describeFinding(f), /3\.60\/4/);
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

await testAsync("RULES.md is what tools/rules-md.ts generates from rules/", async () => {
  // The page is derived, never edited: a rule added, moved or refitted
  // without `npm run rules:md` fails here rather than shipping a list that
  // no longer matches the directory it describes.
  const { renderRulesMd } = await import("../tools/rules-md.ts");
  const generated = renderRulesMd("rules", process.cwd());
  assert.equal(readFileSync("RULES.md", "utf8"), generated, "RULES.md is stale: run `npm run rules:md`");
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

test("rules: a rules path that does not exist is a load error, and a directory that is no language admits nothing", () => {
  const { rules, errors } = loadRules(["/nonexistent/rules"]);
  assert.deepEqual(rules, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /nonexistent/);
  assert.equal(languageDirGrammars("experimental"), null, "not a language: a rule under it has no language directory");
  assert.deepEqual(languageDirGrammars("rust"), ["Rust"]);
  assert.ok(languageDirGrammars("typescript")!.includes("Tsx"), "the listed family");
});

test("rules: a language the package ships rules for loads without a parser, and a run without one says which rules it left out", () => {
  // A rule for a grammar ast-grep does not have built in ships all the same:
  // `rules/moonbit/` is in the package, and loading it must not depend on
  // anyone having built a parser -- `eval --replay`, `rules` and RULES.md all
  // load rules without scanning a line. What needs the parser is the scan, and
  // a run that has no `languages:` for it drops those rules and says so rather
  // than reporting a language's worth of nothing.
  assert.equal(normalizeLanguage("moonbit"), "moonbit", "shipped rules name it, so it is a name");
  assert.deepEqual(languageDirGrammars("moonbit"), ["moonbit"]);
  assert.deepEqual(SHIPPED_CUSTOM_LANGUAGES.moonbit!.extensions, ["mbt"]);
  assert.equal(SHIPPED_CUSTOM_LANGUAGES.moonbit!.expandoChar, "_", "or a pattern with a metavariable matches nothing");
  const mbt = normalizeRule({ id: "m", language: "moonbit", rule: { kind: "function_definition" }, ask: "a." }).rule!;
  const ts = normalizeRule({ id: "t", language: "TypeScript", rule: { kind: "function_declaration" }, ask: "a." }).rule!;
  assert.deepEqual(undeclared([mbt, ts], {}), ["moonbit"]);
  assert.deepEqual(undeclared([mbt, ts], { moonbit: { libraryPath: "/opt/m.so", extensions: ["mbt"] } }), []);
  assert.deepEqual(undeclared([ts], {}), []);
});

test("rules: `divergent` declares a deliberate difference, and silences the drift warning for that id", () => {
  const root = mkdtempSync(join(tmpdir(), "jev-divergent-"));
  try {
    const write = (rel: string, text: string) => {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    write("typescript/a/rule.yml", "id: a\nlanguage: TypeScript\nrule: { kind: x }\nask: one\n");
    write(
      "rust/a/rule.yml",
      "id: a\nlanguage: Rust\nrule: { kind: y }\nask: two\ndivergent: Rust puts failure in the type, so the sentence is about panic, not throw\n",
    );
    const { rules, errors, warnings } = loadRules([root]);
    assert.equal(rules.length, 2);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
    assert.equal(rules.find((r) => r.languageDir === "rust")!.divergent?.startsWith("Rust puts"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rules: `divergent` on sentences that do not differ is a warning of its own", () => {
  const root = mkdtempSync(join(tmpdir(), "jev-divergent-dead-"));
  try {
    const write = (rel: string, text: string) => {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    write("typescript/a/rule.yml", "id: a\nlanguage: TypeScript\nrule: { kind: x }\nask: same\n");
    write("rust/a/rule.yml", "id: a\nlanguage: Rust\nrule: { kind: y }\nask: same\ndivergent: it is not\n");
    const { errors, warnings } = loadRules([root]);
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1, warnings.join("\n"));
    assert.match(warnings[0]!, /divergent/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rules: `divergent` must say why, not just that", () => {
  const root = mkdtempSync(join(tmpdir(), "jev-divergent-empty-"));
  try {
    mkdirSync(join(root, "typescript/a"), { recursive: true });
    writeFileSync(join(root, "typescript/a/rule.yml"), "id: a\nlanguage: TypeScript\nrule: { kind: x }\nask: one\ndivergent: true\n");
    const { errors } = loadRules([root]);
    assert.equal(errors.length, 1, errors.join("\n"));
    assert.match(errors[0]!, /`divergent` must say why/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rules: every field `normalizeRule` validates refuses a bad value by name", () => {
  // A table, because the branches are the point: `jev-lint review` found that
  // a third of `normalizeRule`'s failure paths had never been driven, which is
  // how the `unsureBelow` override of section 6 shipped doing nothing. Each
  // row is one refusal, and the regex is what the message must still say --
  // the field's name, so a typo in a rule file lands on the field and not on
  // a stack trace. One good rule, mutated one field at a time.
  const good = { id: "a", language: "TypeScript", rule: { kind: "x" }, ask: "a." };
  const rows: [string, unknown, RegExp][] = [
    ["not a mapping at all", ["id: a"], /not a mapping/],
    ["no language", { id: "a", rule: { kind: "x" }, ask: "a." }, /missing `language`/],
    ["an arm that is not one", { ...good, state: "sideways" }, /`state` must be one of/],
    ["an axis that is not one", { ...good, axis: "diagonal" }, /`axis` must be/],
    ["a severity that is not one", { ...good, severity: "loud" }, /`severity` must be/],
    ["an unsureBelow outside 0..1", { ...good, unsureBelow: 2 }, /`unsureBelow` must be a number between 0 and 1/],
    ["a subject that is not one", { ...good, subject: "paragraph" }, /`subject` must be/],
    ["a matcher that is not a mapping", { ...good, rule: "kind: x" }, /`rule` must be a mapping, not string/],
    ["a kind that is not one", { ...good, kind: "guess" }, /`kind` must be/],
    ["criteria that are not the two branches", { ...good, kind: "noul", criteria: "yes" }, /`criteria` must be a mapping with `true` and `false`/],
    ["a criterion's not_for that is not a sentence", { ...good, kind: "noul", criteria: { true: { what: "w", not_for: 3 }, false: "f" } }, /not_for must be a non-empty string/],
    ["a block rule's split that is not a regex string", { id: "a", language: "Text", subject: "block", split: 42, extensions: ["sql"], ask: "a." }, /`split` must be a regex matched at the start of each line/],
    ["split on a rule that is not a block rule", { ...good, split: "^(?<NAME>\\w+)" }, /`split` and `extensions` belong to `subject: block` rules/],
  ];
  for (const [what, raw, expected] of rows) {
    const { rule, error } = normalizeRule(raw as never);
    assert.equal(rule, undefined, `${what}: should not have normalized`);
    assert.match(error!, expected, what);
  }
  // And the good rule itself normalizes, so the table is measuring the field
  // under test and not a typo shared by every row.
  assert.equal(normalizeRule(good).error, undefined);
});

test("rules: `shell` is a language directory, and its rules read sh, bash and zsh", () => {
  // One grammar, three shells: ast-grep's `Bash` parses sh and zsh too, and
  // the dir is named for what a reader is looking for -- a script -- not for
  // the one of the three the grammar happens to be named after.
  assert.deepEqual(languageDirGrammars("shell"), ["Bash"]);
  assert.deepEqual(languageDirGrammars("bash"), ["Bash"], "the grammar's own name still works");
  const { rule, error } = normalizeRule({ id: "a", language: "Bash", rule: { kind: "program" }, ask: "a." });
  assert.equal(error, undefined);
  assert.deepEqual(rule!.languages, ["Bash"]);
});
