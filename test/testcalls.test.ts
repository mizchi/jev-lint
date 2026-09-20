import { strict as assert } from "node:assert";
import { builtinUtils, referencedBuiltinUtils, suiteCallRule, testCallRule, TEST_FRAMEWORKS } from "../src/testcalls.ts";
import { test } from "./harness.ts";

test("testcalls: the built-in utils exist for the ECMAScript grammars only, and a rule gets the ones it names", () => {
  assert.deepEqual(Object.keys(builtinUtils("TypeScript")).sort(), ["jev-suite-call", "jev-test-call"]);
  assert.deepEqual(builtinUtils("Rust"), {}, "no `it(...)` in a grammar that has none");
  assert.deepEqual(builtinUtils("Jsx"), builtinUtils("JavaScript"));
  // Only what the matcher refers to, and never over a util of the rule's own
  // by the same name -- a project may redefine what a test is.
  assert.deepEqual(Object.keys(referencedBuiltinUtils({ matches: "jev-test-call" }, null, "TypeScript")), ["jev-test-call"]);
  assert.deepEqual(referencedBuiltinUtils({ kind: "call_expression" }, null, "TypeScript"), {});
  assert.deepEqual(referencedBuiltinUtils({ matches: "jev-test-call" }, { "jev-test-call": { kind: "x" } }, "TypeScript"), {});
  assert.deepEqual(referencedBuiltinUtils({ matches: "jev-test-call" }, null, "Rust"), {}, "left for ast-grep to reject by name");
  // The probe and the rules share one definition, differing only in the
  // meta-variable the title lands in.
  assert.deepEqual(JSON.stringify(testCallRule("$JEVNAME")).replace(/\$JEVNAME/g, "$TITLE"), JSON.stringify(testCallRule()));
  assert.deepEqual(JSON.stringify(suiteCallRule("$JEVNAME")).replace(/\$JEVNAME/g, "$TITLE"), JSON.stringify(suiteCallRule()));
  assert.ok(TEST_FRAMEWORKS.includes("node:test") && TEST_FRAMEWORKS.includes("bun:test"));
});
