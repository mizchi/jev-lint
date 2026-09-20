import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cache, contextKey } from "../src/cache.ts";
import { buildQuestion } from "../src/questions.ts";
import { normalizeRule, loadRules } from "../src/rules.ts";
import { buildSymbols, emitRuleFile, astGrepRuleId, baseRuleId, toAstGrepRule } from "../src/scan.ts";
import type { AstGrepMatch } from "../src/types.ts";
import { isMatcherRule } from "../src/types.ts";
import { probeMatch, test, testAsync, scoreRule, noulRule } from "./helpers.ts";

test("scan: emitted rules are valid ast-grep rules with jev-lint fields stripped", () => {
  const r = scoreRule({ at: 2, note: "x" });
  assert.ok(isMatcherRule(r));
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
  assert.ok(isMatcherRule(r));
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

await testAsync("scan: the test-call matcher knows jest, vitest, node:test, playwright, deno and bun, and only calls with a body", async () => {
  // One matcher, shared by the five test rules and the container probe, so
  // a framework added here is added everywhere at once. Each line below is
  // one shape a framework writes a test in; the title is what the model is
  // asked about, so it has to come out of every shape by the same name.
  const { collectSubjects } = await import("../src/run.ts");
  const { rules } = loadRules(["rules"]);
  const rule = rules.find((r) => r.languageDir === "typescript" && r.id === "test-name-verifies-claim")!;
  const dir = mkdtempSync(join(tmpdir(), "jev-frameworks-"));
  try {
    writeFileSync(
      join(dir, "frameworks.test.ts"),
      [
        `import { test, describe, it } from "node:test";`,
        `test("node plain", () => {});`,
        `test("node with options", { timeout: 100 }, async () => {});`,
        `test("node parent of subtests is their suite, not a test", async (t) => { await t.test("node subtest", () => {}); });`,
        `test.only("node only", () => {});`,
        `test.describe("pw suite", () => { test("pw test", async ({ page }) => {}); });`,
        `test.fixme("pw fixme", async () => {});`,
        `test.step("pw step is not a test", async () => {});`,
        `Deno.test("deno plain", () => {});`,
        `Deno.test({ name: "deno object", fn() {} });`,
        `Deno.test(function denoNamed() {});`,
        `Deno.test.ignore("deno ignore", () => {});`,
        `Deno.test("deno opts", { permissions: "none" }, () => {});`,
        `test.if(true)("bun if", () => {});`,
        `test.skipIf(false)("vitest skipIf", () => {});`,
        `it.each([1, 2])("each %d", (n) => {});`,
        `it.concurrent.skip("vitest concurrent skip", () => {});`,
        `test.fails("vitest fails", () => {});`,
        `it.todo("todo has no body to judge");`,
        `test("timeout third", () => {}, 1000);`,
        `xit("jest xit", () => {}); fit("jest fit", () => {});`,
        `it("named function body", function () {});`,
        `/x/.test("a regex test is not a test", () => {});`,
        `if (import.meta.vitest) { const { it } = import.meta.vitest; it("in-source", () => {}); }`,
      ].join("\n"),
    );
    const { subjects } = await collectSubjects({ rules: [rule], paths: ["frameworks.test.ts"], cwd: dir });
    const titles = subjects.map((s) => s.captured.TITLE).sort();
    assert.deepEqual(titles, [
      `"bun if"`, `"deno ignore"`, `"deno object"`, `"deno opts"`, `"deno plain"`, `"each %d"`, `"in-source"`,
      `"jest fit"`, `"jest xit"`, `"named function body"`, `"node only"`, `"node plain"`, `"node subtest"`,
      `"node with options"`, `"pw fixme"`, `"pw test"`, `"timeout third"`, `"vitest concurrent skip"`,
      `"vitest fails"`, `"vitest skipIf"`, `denoNamed`,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("scan: a test inside nested describes carries the whole path, and the question says it", async () => {
  // `it("leaves the others")` claims nothing on its own; under
  // `describe("cart") > describe("removeItem")` it claims that removeItem
  // leaves the other items. The title alone was what the bare arm sent.
  const { collectSubjects } = await import("../src/run.ts");
  const { rules } = loadRules(["rules"]);
  const rule = rules.find((r) => r.languageDir === "typescript" && r.id === "test-name-verifies-claim")!;
  const dir = mkdtempSync(join(tmpdir(), "jev-suites-"));
  try {
    writeFileSync(
      join(dir, "cart.test.ts"),
      [
        `describe("cart", () => {`,
        `  test.describe("removeItem", () => {`,
        `    it("leaves the others", () => { expect(1).toBe(1); });`,
        `  });`,
        `  it("starts empty", () => { expect(1).toBe(1); });`,
        `});`,
        `it("top level", () => { expect(1).toBe(1); });`,
      ].join("\n"),
    );
    const { subjects } = await collectSubjects({ rules: [rule], paths: ["cart.test.ts"], cwd: dir });
    const byTitle = new Map(subjects.map((s) => [s.captured.TITLE, s]));
    assert.deepEqual(byTitle.get(`"leaves the others"`)!.enclosing, { name: "removeItem", role: "suite", path: ["cart", "removeItem"] });
    assert.deepEqual(byTitle.get(`"starts empty"`)!.enclosing, { name: "cart", role: "suite", path: ["cart"] });
    assert.equal(byTitle.get(`"top level"`)!.enclosing, null);
    const q = buildQuestion(rule, byTitle.get(`"leaves the others"`)!, "q1");
    assert.equal((q.instructions as { inside?: string }).inside, "suite `cart` > suite `removeItem`");
    // The path is part of what the model saw, so it is part of the key even
    // on the bare arm, where the file is not.
    assert.notEqual(contextKey(byTitle.get(`"leaves the others"`)!, "bare"), contextKey(byTitle.get(`"starts empty"`)!, "bare"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("scan: a missing ast-grep binary is a named error, not a stack trace", async () => {
  const { runAstGrep, AstGrepError } = await import("../src/scan.ts");
  const was = process.env.JEV_LINT_AST_GREP;
  process.env.JEV_LINT_AST_GREP = "/nonexistent/ast-grep";
  try {
    const rule = noulRule({ id: "r", language: "TypeScript", rule: { kind: "function_declaration" } });
    await assert.rejects(() => runAstGrep([rule], ["src/scan.ts"]), (err: unknown) => err instanceof AstGrepError && /ENOENT|ast-grep/.test(String((err as Error).message)));
  } finally {
    if (was === undefined) delete process.env.JEV_LINT_AST_GREP;
    else process.env.JEV_LINT_AST_GREP = was;
  }
});
