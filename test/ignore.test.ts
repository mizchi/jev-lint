import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { renamedRuleHint, parseIgnores, isIgnored, unknownIgnoredRules } from "../src/ignore.ts";
import { test } from "./helpers.ts";

test("ignore: a suppression naming a pre-0.3 language-suffixed id is told the new name", () => {
  // `fn-name-promises-rust` became `rust/fn-name-promises`, and a comment
  // naming it now suppresses nothing. The unknown-rule line says so and
  // names the id that works, instead of leaving a reader to guess.
  const known = ["fn-name-promises", "comment-describes-declaration", "var-name-describes-value"];
  assert.equal(renamedRuleHint("fn-name-promises-rust", known), "fn-name-promises (the -rust suffix went in 0.3.0; the id names every language)");
  assert.equal(renamedRuleHint("comment-describes-declaration-js", known), "comment-describes-declaration (the -js suffix went in 0.3.0; the id names every language)");
  assert.equal(renamedRuleHint("no-such-rule-rust", known), null, "a suffix on an unknown base is not a rename");
  assert.equal(renamedRuleHint("fn-name-promises", known), null);
});

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
