import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { findConfig, loadConfig } from "../src/config.ts";
import { gate } from "../src/gate.ts";
import { isTestFile, findTestFiles, relatedTestFiles, compactTest, pairTests, importsModule, inSourceTests, excerptBudget, MAX_RELATED_TESTS, TEST_EXCERPT_BUDGET, TEST_EXCERPT_PER_SUBJECT, TEST_EXCERPT_MAX } from "../src/paired.ts";
import { test } from "./harness.ts";

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

test("paired: a colocated .vitest.ts file is discovered as related test evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-paired-vitest-"));
  try {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/cart.ts"), "export const total = () => 0;\n");
    writeFileSync(join(dir, "src/cart.vitest.ts"), 'import { total } from "./cart";\ntest("total", () => total());\n');

    assert.ok(isTestFile("src/cart.vitest.ts"));
    assert.deepEqual(findTestFiles(["src"], dir), ["src/cart.vitest.ts"]);
    const paired = pairTests(["src/cart.ts"], { roots: ["src"], cwd: dir, keywords: () => ["total"] });
    assert.deepEqual(paired.get("src/cart.ts")?.map((test) => test.path), ["src/cart.vitest.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("paired: MoonBit whitebox tests are discovered beside their module", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-paired-wbtest-"));
  try {
    mkdirSync(join(dir, "src", "loader"), { recursive: true });
    writeFileSync(join(dir, "src", "loader", "download.mbt"), "pub fn download() -> Unit raise { fail() }\n");
    writeFileSync(join(dir, "src", "loader", "download_wbtest.mbt"), 'test "download failure" { inspect(download()) }\n');

    assert.ok(isTestFile("src/loader/download_wbtest.mbt"));
    assert.ok(!isTestFile("src/loader/download_wbtest.ts"));
    assert.deepEqual(findTestFiles(["src"], dir), ["src/loader/download_wbtest.mbt"]);
    const paired = pairTests(["src/loader/download.mbt"], { roots: ["src"], cwd: dir, keywords: () => ["download"] });
    assert.deepEqual(paired.get("src/loader/download.mbt")?.map((test) => test.path), ["src/loader/download_wbtest.mbt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  // A name match outranks an import match, whatever the alphabet says.
  // When this repository's suite was split into one file per module, every
  // file imported rules.ts for a fixture builder, and the four related
  // tests of rules.ts were the first four alphabetically -- evals, gate,
  // helpers, questions -- with rules.test.ts fifth and out.
  const importers = new Map(
    ["test/evals.test.ts", "test/gate.test.ts", "test/helpers.ts", "test/questions.test.ts", "test/rules.test.ts"].map((p) => [p, 'import { normalizeRule } from "../src/rules.ts";']),
  );
  const forRules = relatedTestFiles("src/rules.ts", [...importers.keys()], (p) => importers.get(p) ?? "");
  assert.equal(forRules[0], "test/rules.test.ts");
  assert.equal(forRules.length, MAX_RELATED_TESTS);
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
  // One hop: a test that drives an entry point which imports the module is
  // that module's test too. This repository's command modules are exercised
  // through `main.ts` and were reported as having no test at all.
  const hop = new Map([
    ["src/cli/main.ts", 'import { cmdCheck } from "./cmd-check.ts";\nimport { x } from "../rules.ts";'],
    ["src/cli/cmd-check.ts", 'import { run } from "../run.ts";'],
  ]);
  const readHop = (p: string) => hop.get(p) ?? "";
  assert.ok(importsModule('import { main } from "../src/cli/main.ts"', "src/cli/cmd-check.ts", "test/commands.test.ts", readHop), "through main");
  assert.ok(!importsModule('import { main } from "../src/cli/main.ts"', "src/run.ts", "test/commands.test.ts", readHop), "one hop, not two");
  assert.ok(!importsModule('import { main } from "../src/cli/main.ts"', "src/cli/cmd-check.ts", "test/commands.test.ts"), "and only when the sources can be read");
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

test("paired: over the budget, the excerpt keeps the tests that name the first keywords and drops the rest", () => {
  // One test file for a whole repository, every module paired with it.
  // Keyed on the module's stem, `config` matched three hundred lines of
  // `--config` flags and the excerpt was cut from the middle -- which is
  // where the one test of `findConfig`'s throw sat. Keywords are in
  // priority order, the subjects' own names first and the stem last, and
  // what goes over the budget is the lowest-priority region, not the middle.
  const flood = Array.from({ length: 300 }, (_, i) => `test("config flag ${i}", () => { run(["--config", "c${i}.yaml"]); });`);
  const wanted = [
    `test("findConfig throws on two spellings in one directory", () => {`,
    `  writeFileSync(join(dir, ".jev-lint.yaml"), "");`,
    `  writeFileSync(join(dir, "jev-lint.yaml"), "");`,
    `  assert.throws(() => findConfig(dir), /2 config files/);`,
    `});`,
  ];
  const content = [...flood.slice(0, 150), ...wanted, ...flood.slice(150)].join("\n");
  const cut = compactTest("test/test.ts", content, ["findConfig", "loadConfig", "config"], 2000).code;
  assert.ok(cut.length <= 2000 + 8, `${cut.length} chars`);
  assert.ok(cut.includes("assert.throws(() => findConfig(dir)"), `the findConfig test survives:\n${cut}`);
  assert.ok(cut.includes("…"), "and the cut is marked");
  // With room for everything, file order is kept.
  const whole = compactTest("t.ts", "gate();\nx;\nx;\nx;\nx;\nx;\naggregate();", ["aggregate", "gate"]).code;
  assert.equal(whole, "gate();\nx;\nx;\n…\nx;\nx;\naggregate();");
});

test("paired: among the related tests, the ones that name the subjects asked about come first", () => {
  // Four related files fit, and the fifth held the test of the function
  // being asked about. The pairing is by name and import; the choice
  // among what paired is by what the tests mention.
  const source = "export function a() { throw 1; }\n";
  const files = new Map<string, string>([
    ["test/m.test.ts", 'import { b } from "../src/m.ts";\nit("b", () => b());'],
    ["test/one.test.ts", 'import { c } from "../src/m.ts";\nit("c", () => c());'],
    ["test/two.test.ts", 'import { c } from "../src/m.ts";\nit("c again", () => c());'],
    ["test/three.test.ts", 'import { c } from "../src/m.ts";\nit("c thrice", () => c());'],
    ["test/zed.test.ts", 'import { a } from "../src/m.ts";\nit("a throws", () => { expect(() => a()).toThrow(); });'],
  ]);
  const read = (p: string) => (p === "src/m.ts" ? source : files.get(p) ?? "");
  const paired = pairTests(["src/m.ts"], { roots: ["src"], testFiles: [...files.keys()], readSource: read, keywords: () => ["a", "b", "c"] });
  const got = paired.get("src/m.ts")!.map((t) => t.path);
  assert.equal(got[0], "test/zed.test.ts", `the file naming the first keyword leads: ${got.join(", ")}`);
  assert.equal(got.length, MAX_RELATED_TESTS);
});

test("paired: the excerpt budget grows with the subjects asked about in the file, to a cap", () => {
  assert.equal(excerptBudget(1), TEST_EXCERPT_BUDGET);
  assert.equal(excerptBudget(0), TEST_EXCERPT_BUDGET);
  assert.equal(excerptBudget(10), TEST_EXCERPT_BUDGET + 9 * TEST_EXCERPT_PER_SUBJECT);
  assert.equal(excerptBudget(1000), TEST_EXCERPT_MAX);
  const source = "export function a() { throw 1; }\nexport function b() { throw 2; }\n";
  const test = Array.from({ length: 400 }, (_, i) => `it("a ${i}", () => { expect(() => a()).toThrow(); });`).join("\n");
  const read = (p: string) => (p === "src/m.ts" ? source : test);
  const small = pairTests(["src/m.ts"], { roots: ["src"], testFiles: ["src/m.test.ts"], readSource: read, keywords: () => ["a", "b"] });
  const large = pairTests(["src/m.ts"], { roots: ["src"], testFiles: ["src/m.test.ts"], readSource: read, keywords: () => ["a", "b"], budget: () => excerptBudget(4) });
  assert.ok(small.get("src/m.ts")![0]!.code.length <= TEST_EXCERPT_BUDGET + 8);
  assert.ok(large.get("src/m.ts")![0]!.code.length > TEST_EXCERPT_BUDGET + 8, "four subjects buy a longer excerpt");
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
    // A file that DEFINES `test` -- a suite's harness -- opens no test, and
    // is not one: this repository's test/helpers.ts paired with every
    // module, and took a share of every excerpt budget, for a definition.
    writeFileSync(join(dir, "test/harness.ts"), "export function test(name: string, fn: () => void): void { fn(); }\nexport const it = test;\n");
    assert.ok(!findTestFiles(["src"], dir).includes("test/harness.ts"), "a definition is not an opener");
    // pairTests reads and compacts, keyed by the source file.
    writeFileSync(join(dir, "test/cart.test.ts"), 'it("totals", () => total([]));');
    writeFileSync(join(dir, "src/cart.test.ts"), "const setup = 1;");
    const paired = pairTests(["src/cart.ts", "src/nothing.ts", "src/empty.ts"], { roots: ["src"], cwd: dir, keywords: () => ["total"] });
    // The file that names `total` comes first, whatever the pairing order.
    assert.deepEqual(paired.get("src/cart.ts")!.map((t) => t.path), ["test/cart.test.ts", "src/cart.test.ts"]);
    assert.deepEqual(paired.get("src/cart.ts")!.map((t) => t.via), ["name", "name"], "and says how each was paired");
    assert.equal(paired.get("src/cart.ts")![0]!.code, 'it("totals", () => total([]));');
    assert.equal(paired.get("src/cart.ts")![1]!.code, "const setup = 1;", "nothing matched: sent whole");
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

test("paired: the in-source block is cut where its braces balance, and a module without one has none", () => {
  assert.equal(inSourceTests("export const a = 1;\n"), null);
  const block = "if (import.meta.vitest) {\n  it('x', () => { expect(1).toBe(1); });\n}\n";
  assert.equal(inSourceTests(`export const a = 1;\n${block}export const b = 2;\n`), block.trimEnd());
  // A stray `}` in a string ends the block there; a stray `{` runs it to the end of the file.
  assert.equal(inSourceTests("if (import.meta.vitest) {\n  const s = '}';\n  it('y', () => {});\n}\n"), "if (import.meta.vitest) {\n  const s = '}");
  const open = "if (import.meta.vitest) {\n  const s = '{';\n  it('z', () => {});\n}\n";
  assert.equal(inSourceTests(open), open);
});

test("paired: a file with vitest in-source tests is its own related test", () => {
  const source = [
    `export function parse(s: string) { if (!s) throw new Error("empty"); return s; }`,
    `if (import.meta.vitest) {`,
    `  const { it, expect } = import.meta.vitest;`,
    `  it("parse returns the string", () => { expect(parse("a")).toBe("a"); });`,
    `}`,
  ].join("\n");
  const read = (p: string) => (p === "src/parse.ts" ? source : "");
  const paired = pairTests(["src/parse.ts"], { roots: ["src"], testFiles: [], readSource: read });
  const related = paired.get("src/parse.ts")!;
  assert.equal(related.length, 1);
  assert.equal(related[0]!.path, "src/parse.ts");
  assert.equal(related[0]!.via, "in-source");
  assert.ok(related[0]!.code.includes(`it("parse returns the string"`));
  assert.ok(!related[0]!.code.includes("export function parse"), "the excerpt is the test block, not the module");
  assert.ok(isTestFile("src/parse.ts", source) === false, "the file is not a test file: it is a module that carries tests");
});
