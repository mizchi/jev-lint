import { strict as assert } from "node:assert";
import { planBatches } from "../src/batch.ts";
import { enclosingSymbol, moduleIdentity } from "../src/scan.ts";
import { buildState, resolveSubject, renderOutline, capturedMetavariables, widenCommentCapture, OUTLINE_TEXT_LIMIT } from "../src/state.ts";
import type { AstGrepMatch, StateArm } from "../src/types.ts";
import { changeRule, scoreRule, subjectOf, sampleEntry } from "./builders.ts";
import { test } from "./harness.ts";

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

test("state: a change subject's state carries the instructions and the diff", () => {
  const rule = changeRule();
  const subject = subjectOf({
    rule, file: "abc", text: " cart.ts | 2 +-\n 1 file changed",
    nodeKind: "change", arm: "bare", language: "Git",
    commit: { files: ["cart.ts"], stat: " 1 file changed", diff: "diff --git a/cart.ts", truncated: false },
    instructions: { docs: [{ file: "AGENTS.md", text: "- Never use `any`.\n" }], truncated: false },
  });
  const [batch] = planBatches([subject]);
  assert.deepEqual(batch!.state.instructions, [{ file: "AGENTS.md", text: "- Never use `any`.\n" }]);
  assert.equal(batch!.state.diff, "diff --git a/cart.ts");
  assert.equal(batch!.state.message, undefined, "a change rule is not handed a message to be distracted by");
  assert.match(String(batch!.state.reviewing), /instructions/);
  assert.equal(batch!.state.note_on_instructions, undefined);
});

test("state: a cut instruction document says so, so a rule that is still there is not read as gone", () => {
  const rule = changeRule();
  const subject = subjectOf({
    rule, file: "abc", text: " 1 file changed",
    nodeKind: "change", arm: "bare", language: "Git",
    commit: { files: ["a.ts"], stat: " 1 file changed", diff: "d", truncated: false },
    instructions: { docs: [{ file: "AGENTS.md", text: "- One.\n" }], truncated: true },
  });
  const [batch] = planBatches([subject]);
  assert.match(String(batch!.state.note_on_instructions), /cut/);
});
