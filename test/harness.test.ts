import { strict as assert } from "node:assert";
import { formatFailure, test, MAX_FAIL_LINES, MAX_FAIL_LINE } from "./harness.ts";

// The reporter itself. Every other file in this suite is read through it, so
// a failure it renders unreadably costs more than the test it is reporting.

test("harness: a short failure is printed whole, indented under its name", () => {
  const out = formatFailure("some check", new Error("expected 2, got 3"));
  assert.equal(out, "FAIL  some check\n      expected 2, got 3\n");
});

test("harness: a failure longer than the cap keeps its head and counts the rest", () => {
  // Node appends its own diff to a custom message when two long strings are
  // compared, which is how a 45,000-character page reached the terminal.
  const message = ["RULES.md is stale: run `npm run rules:md`", ...Array.from({ length: 400 }, (_, i) => `line ${i}`)].join("\n");
  const out = formatFailure("RULES.md check", new Error(message));
  const lines = out.split("\n").filter((l) => l !== "");
  // The name, the cap, and the one line saying what was dropped.
  assert.equal(lines.length, 1 + MAX_FAIL_LINES + 1);
  // What to do survives: it is the first thing after the name.
  assert.match(lines[1]!, /RULES\.md is stale: run `npm run rules:md`$/);
  assert.match(lines.at(-1)!, /\.\.\. 377 more line\(s\)/);
});

test("harness: one very long line is cut and says by how much", () => {
  const out = formatFailure("wide", new Error("x".repeat(MAX_FAIL_LINE + 55)));
  assert.match(out, new RegExp(`x{${MAX_FAIL_LINE}} \\.\\.\\. \\+55 chars`));
  assert.equal(out.includes("x".repeat(MAX_FAIL_LINE + 1)), false);
});

test("harness: something thrown that is not an Error still reports", () => {
  assert.equal(formatFailure("odd", "just a string"), "FAIL  odd\n      just a string\n");
});
