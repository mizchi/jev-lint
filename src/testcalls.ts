/**
 * What a test looks like, once, for every ECMAScript test framework.
 *
 * Five shipped rules ask about a test by its title, and the container probe
 * names the statements inside one by it. Each used to carry its own list of
 * `it($TITLE, $BODY)` patterns, which knew jest and vitest and nothing else:
 * `test("x", { timeout }, fn)` from node:test, `test.describe` from
 * Playwright, `Deno.test({ name, fn })`, `test.if(cond)("x", fn)` from bun
 * were never asked about, and a matcher that misses is invisible. This is
 * the one definition, as ast-grep utils a rule names with
 * `matches: jev-test-call` / `matches: jev-suite-call` and the probe
 * embeds; jev-lint puts the utils into the rule when it emits it.
 *
 * A test is a call whose callee is a test function -- `it`, `test`, their
 * `x`/`f` prefixes, `Deno.test`, node:test's `t.test` subtest -- through
 * any chain of the modifiers the frameworks define (`.only`, `.skip`,
 * `.each(...)`, `.skipIf(...)`, `.fails`, `.fixme`, ...), whose title is a
 * string, a `{ name }` property, or the name of the function passed, and
 * which carries a function to judge: `it.todo("x")` has no body and is not
 * a test, and `/x/.test(s)` passes no function. `test.step` is a step of a
 * test, not one, and is not matched.
 */
import type { Language } from "./types.ts";

/** The frameworks the matcher is written against, for the docs and the rule comments. */
export const TEST_FRAMEWORKS = ["jest", "vitest", "vitest in-source", "node:test", "@playwright/test", "Deno.test", "bun:test"] as const;

/** `describe(...)` and its spellings; Playwright's `test.describe` with its own modifiers. */
const SUITE_CALLEE =
  "^(x|f)?(describe|suite|context)(\\.(only|skip|todo|concurrent|sequential|shuffle|skipIf|runIf|if|each|for)(\\([^)]*\\))?)*$" +
  "|^test\\.describe(\\.(serial|parallel|only|skip|fixme|configure)(\\([^)]*\\))?)*$";

/** The names node:test's context goes by, for `t.test("subtest", fn)`. */
const SUBTEST_CONTEXT = "(t|ctx|context)";

/** A subtest call, wherever it sits inside the parent. */
const SUBTEST_INSIDE = { stopBy: "end", kind: "call_expression", has: { field: "function", regex: `^${SUBTEST_CONTEXT}\\.test$` } };

/** `it`/`test` and their spellings with modifiers; `Deno.test`; node:test's subtest on the context. */
const TEST_CALLEE =
  "^(x|f)?(it|test)(\\.(only|skip|todo|concurrent|sequential|fails|fixme|slow|skipIf|runIf|if|todoIf|failsIf|each|for)(\\([^)]*\\))?)*$" +
  "|^Deno\\.test(\\.(only|ignore))?$" +
  `|^${SUBTEST_CONTEXT}\\.test$`;

const FUNCTION_KINDS = [{ kind: "arrow_function" }, { kind: "function_expression" }, { kind: "generator_function" }];

/** The title, by whichever of the three shapes carries it, captured as `title`. */
function titleOf(title: string): Record<string, unknown> {
  return {
    field: "arguments",
    any: [
      { has: { nthChild: 1, any: [{ kind: "string" }, { kind: "template_string" }], pattern: title } },
      {
        has: {
          nthChild: 1,
          kind: "object",
          has: { kind: "pair", all: [{ has: { field: "key", regex: "^name$" } }, { has: { field: "value", pattern: title } }] },
        },
      },
      { has: { nthChild: 1, kind: "function_expression", has: { field: "name", pattern: title } } },
    ],
  };
}

/**
 * A test call; its title lands in the meta-variable named by `title` and
 * its body in `body`. The body travels in the question as a capture beside
 * the code -- the rules were calibrated with it there, and taking it away
 * moved two clean cases over the cutoff.
 */
export function testCallRule(title = "$TITLE", body = "$BODY"): Record<string, unknown> {
  return {
    kind: "call_expression",
    all: [
      { has: { field: "function", regex: TEST_CALLEE } },
      { has: titleOf(title) },
      // A node:test parent whose body opens subtests is their suite, not a
      // test of its own: `test("applyDiscount", async (t) => { await
      // t.test(...) })` claims nothing but a grouping. It matches as a suite.
      { not: { has: SUBTEST_INSIDE } },
      // A body to judge: an arrow, a function, or for Deno's object form the
      // `fn` method (or `fn: () => ...` pair) inside the object argument.
      {
        has: {
          field: "arguments",
          any: [
            { has: { any: FUNCTION_KINDS, pattern: body } },
            { has: { kind: "object", has: { any: [{ kind: "method_definition" }, { kind: "pair", has: { any: FUNCTION_KINDS } }], pattern: body } } },
          ],
        },
      },
    ],
  };
}

/** A suite call; its title lands in the meta-variable named by `title`, its body in `body`. */
export function suiteCallRule(title = "$TITLE", body = "$BODY"): Record<string, unknown> {
  return {
    kind: "call_expression",
    all: [
      {
        any: [
          { has: { field: "function", regex: SUITE_CALLEE } },
          // A test with subtests inside it (node:test).
          { all: [{ has: { field: "function", regex: TEST_CALLEE } }, { has: SUBTEST_INSIDE }] },
        ],
      },
      { has: { field: "arguments", has: { nthChild: 1, any: [{ kind: "string" }, { kind: "template_string" }], pattern: title } } },
      { has: { field: "arguments", has: { any: FUNCTION_KINDS, pattern: body } } },
    ],
  };
}

const ECMASCRIPT: ReadonlySet<string> = new Set(["TypeScript", "Tsx", "JavaScript", "Jsx"]);

/** The utils a rule of this language may name; none for a grammar these shapes do not exist in. */
export function builtinUtils(language: Language): Record<string, Record<string, unknown>> {
  if (!ECMASCRIPT.has(language)) return {};
  return { "jev-test-call": testCallRule(), "jev-suite-call": suiteCallRule() };
}

/**
 * The built-in utils a rule refers to, to be merged into its own. A util
 * the rule defines under the same name is the rule's, so a project can
 * override one; a reference the language has no util for is left for
 * ast-grep to reject by name.
 */
export function referencedBuiltinUtils(matcher: unknown, own: Record<string, unknown> | null, language: Language): Record<string, unknown> {
  const text = JSON.stringify(matcher);
  const out: Record<string, unknown> = {};
  for (const [name, util] of Object.entries(builtinUtils(language))) {
    if (text.includes(`"${name}"`) && !(own && name in own)) out[name] = util;
  }
  return out;
}
