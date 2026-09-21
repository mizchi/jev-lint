# diff-follows-instructions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Judge a change against the `AGENTS.md` / `CLAUDE.md` the repository wrote for itself, name which instruction it violates, and run it from both git hooks.

**Architecture:** A new subject kind, `change`, whose subject is the diff rather than the commit message, so it also exists before a commit does. Its state carries the instruction documents read from the same tree as the diff. One shipped rule judges it; a second pass splits the documents into directives, asks one question per directive against the same state, attaches what it finds and retracts a finding it cannot attribute. Hook bodies move to `.jev-lint/hooks/` so `commits --staged` can run at pre-commit.

**Tech Stack:** TypeScript on Node 24 (`--experimental-strip-types`, no build step for tests), `node:child_process` for git, the repository's own test harness (`test/harness.ts`, `npm test <substring>`), `jev-lint eval` for rule calibration.

**Spec:** `docs/superpowers/specs/2026-09-21-diff-follows-instructions-design.md`

---

## File Structure

**Created:**

- `src/instructions.ts` — reading `AGENTS.md` / `CLAUDE.md` out of a tree or the index, de-duplicating them, and cutting them to a budget. Knows git; knows nothing about rules.
- `src/directives.ts` — splitting instruction documents into directives. Pure: markdown in, `{file, line, text}[]` out. No git, no model.
- `test/instructions.test.ts`, `test/directives.test.ts`
- `rules/git/diff-follows-instructions/{rule.yml,expect.yml,fixtures/**}`

**Modified:**

- `src/types.ts` — the `change` arm of `RuleSource`, `Subject.instructions`, `Finding.violates`
- `src/rules.ts` — validation for `subject: change`
- `src/commits.ts` — `change` subjects, and building them from the index
- `src/state.ts` — `instructions` and `note_on_instructions` in the commit state
- `src/questions.ts` — `change:` in place of `message:` for a change subject
- `src/gate.ts` — `collect` split out of `gate`, so findings can be re-collected after the attribution pass
- `src/run.ts` — the attribution pass; `--staged` in commits mode
- `src/report.ts` — printing `violates`
- `src/config.ts`, `src/cli/cmd-init.ts` — hook bodies and the shim
- `src/cli/targets.ts`, `src/cli/cmd-check.ts`, `src/cli/args.ts` — `commits --staged`
- `src/cli/dry-run.ts` — change subjects in the plan
- `test/{rules,commits,state,questions,gate,run,report,commands}.test.ts`
- `.jev-lint.yaml`, `RULES.md`, `README.md`, `README-ja.md`, `CHANGELOG.md`

---

## Task 1: `subject: change` loads and validates

**Files:**
- Modify: `src/types.ts` (the `RuleSource` union, around line 290)
- Modify: `src/rules.ts:289`, `src/rules.ts:393-460`
- Test: `test/rules.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/rules.test.ts`:

```ts
test("rules: a `subject: change` rule is Git, matcherless and bare, like a commit rule", () => {
  const { rule, error } = normalizeRule({
    id: "diff-follows-instructions",
    language: "Git",
    subject: "change",
    kind: "noul",
    ask: "This change breaks an instruction.",
    criteria: { true: "y", false: "n" },
    at: 0.6,
  });
  assert.equal(error, undefined, `should load: ${error}`);
  assert.equal(rule!.subject, "change");
  assert.equal(rule!.matcher, null);
  assert.equal(rule!.state, "bare", "a change rule has no file to locate in");
});

test("rules: a `subject: change` rule with a matcher is rejected", () => {
  const { error } = normalizeRule({
    id: "x",
    language: "Git",
    subject: "change",
    kind: "noul",
    rule: { kind: "function_declaration" },
    ask: "a",
    criteria: { true: "y", false: "n" },
  });
  assert.match(String(error), /takes no matcher/);
});

test("rules: a `subject: change` rule in a real grammar is rejected", () => {
  const { error } = normalizeRule({
    id: "x",
    language: "TypeScript",
    subject: "change",
    kind: "noul",
    ask: "a",
    criteria: { true: "y", false: "n" },
  });
  assert.match(String(error), /is `language: Git`/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test rules`
Expected: FAIL — the first with a validation error naming `change` as an unknown subject.

- [ ] **Step 3: Add the `change` arm to `RuleSource`**

In `src/types.ts`, in the `RuleSource` union, change the commit arm's `subject` to cover both:

```ts
  | {
      /**
       * Two subjects with no matcher, both built from git.
       *
       * `commit`: the message is the subject and the diff is what it is
       * judged against. `change`: the change is the subject and the diff
       * plus the repository's instruction documents are its state, so it
       * exists before a commit does and `--staged` can produce one.
       */
      subject: "commit" | "change";
      matcher: null;
      constraints: null;
      utils: null;
      split: null;
      extensions: null;
    }
```

And update `MatcherRule` and `isMatcherRule` below it:

```ts
export type MatcherRule = Rule & { subject: "node" | "enclosing" | "file" };

export function isMatcherRule(rule: Rule): rule is MatcherRule {
  return rule.subject !== "commit" && rule.subject !== "change" && rule.subject !== "block";
}
```

- [ ] **Step 4: Accept it in the loader**

In `src/rules.ts`, line 289, the default-state expression:

```ts
  const state = raw.state === undefined ? (isGitSubject(source.subject) || source.subject === "block" ? "bare" : "located") : raw.state;
```

and at the top of the validation block (replacing `const isCommit = subject === "commit";` at line 396):

```ts
  // `commit` and `change` are both built from git: no matcher, the Git
  // pseudo-grammar, and `state: bare` because there is no file to locate in.
  const isGit = subject === "commit" || subject === "change";
```

Replace every use of `isCommit` in that function with `isGit`, and make the four error messages name the subject the rule actually declared so a `change` rule is not told about commits:

```ts
    return { error: `${id}: a \`subject: ${subject}\` rule is \`language: Git\` and nothing else (got ${languages.join(", ")})` };
```
```ts
    return { error: `${id}: \`Git\` is the grammar of \`subject: commit\` and \`subject: change\` rules only; a ${JSON.stringify(raw.subject ?? "node")} subject needs a real grammar` };
```
```ts
      return { error: `${id}: a \`subject: ${subject}\` rule takes no matcher; its subjects are ${subject === "commit" ? "commits" : "changes"}, not nodes` };
```
```ts
      return { error: `${id}: a \`subject: ${subject}\` rule is \`state: bare\`; the diff is its state and there is no file to locate in` };
```

At line 459, widen the returned source arm:

```ts
  if (isGit) return { subject, matcher: null, constraints: null, utils: null, split: null, extensions: null };
```

Add the helper beside `isMatcherRule` in `src/types.ts`:

```ts
/** The two subjects git builds: no matcher, `language: Git`, `state: bare`. */
export function isGitSubject(subject: string): boolean {
  return subject === "commit" || subject === "change";
}
```

and import it in `src/rules.ts`.

Finally, `src/types.ts:118` enumerates the valid values, which is what
`src/rules.ts:390` validates against:

```ts
export const SUBJECTS = ["node", "enclosing", "file", "commit", "change", "block"] as const;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test rules`
Expected: PASS, and no other rules test regresses.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/types.ts src/rules.ts test/rules.test.ts
git commit -m "rules: a subject whose subject is the change, not the message

\`subject: change\` joins \`subject: commit\` as a subject git builds
rather than ast-grep: matcherless, \`language: Git\`, \`state: bare\`. The
difference is what is judged. A commit rule judges the message and reads
the diff as evidence, so it needs a commit to exist. A change rule judges
the change itself, which is also what is sitting in the index before a
commit exists.

Nothing produces one yet."
```

---

## Task 2: Reading the instruction documents

**Files:**
- Create: `src/instructions.ts`
- Test: `test/instructions.test.ts`
- Modify: `test/test.ts` (register the file)

The documents are read with `git show`, so they come from the same tree as
the diff: `git show <sha>:AGENTS.md` for a commit, `git show :AGENTS.md`
for the index.

- [ ] **Step 1: Write the failing tests**

Create `test/instructions.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { MAX_INSTRUCTION_CHARS, readInstructions } from "../src/instructions.ts";
import { tempRepo } from "./builders.ts";
import { test } from "./harness.ts";

test("instructions: both documents are read from the commit's own tree", () => {
  const dir = tempRepo([
    { message: "Set the rules", files: { "AGENTS.md": "- Never use `any`.\n", "CLAUDE.md": "- Write commits in English.\n" } },
    { message: "Loosen them", files: { "AGENTS.md": "- `any` is fine now.\n" } },
  ]);
  try {
    const first = readInstructions("HEAD~1", dir);
    assert.deepEqual(first.docs.map((d) => d.file), ["AGENTS.md", "CLAUDE.md"]);
    assert.match(first.docs[0]!.text, /Never use/, "the older commit is judged by the older document");
    const second = readInstructions("HEAD", dir);
    assert.match(second.docs[0]!.text, /fine now/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: a repository with neither document yields nothing", () => {
  const dir = tempRepo([{ message: "Add cart", files: { "cart.ts": "a\n" } }]);
  try {
    const got = readInstructions("HEAD", dir);
    assert.deepEqual(got.docs, [], "no document is not an empty document");
    assert.equal(got.truncated, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: a CLAUDE.md that only points at AGENTS.md is dropped, not doubled", () => {
  const same = "- Never use `any`.\n";
  const dir = tempRepo([{ message: "Rules", files: { "AGENTS.md": same, "CLAUDE.md": same } }]);
  const pointer = tempRepo([{ message: "Rules", files: { "AGENTS.md": same, "CLAUDE.md": "See AGENTS.md\n" } }]);
  try {
    assert.deepEqual(readInstructions("HEAD", dir).docs.map((d) => d.file), ["AGENTS.md"], "identical content");
    assert.deepEqual(readInstructions("HEAD", pointer).docs.map((d) => d.file), ["AGENTS.md"], "a one-line pointer");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(pointer, { recursive: true, force: true });
  }
});

test("instructions: over the budget the text is cut at a line boundary and says so", () => {
  const big = `${Array.from({ length: 4000 }, (_, i) => `- rule number ${i}, which is a sentence long enough to matter`).join("\n")}\n`;
  const dir = tempRepo([{ message: "Rules", files: { "AGENTS.md": big } }]);
  try {
    const got = readInstructions("HEAD", dir);
    assert.equal(got.truncated, true);
    assert.ok(got.docs[0]!.text.length <= MAX_INSTRUCTION_CHARS, `${got.docs[0]!.text.length} chars`);
    assert.ok(got.docs[0]!.text.endsWith("\n"), "cut at a line boundary, never mid-sentence");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: the index is where --staged reads them", () => {
  const dir = tempRepo([{ message: "Rules", files: { "AGENTS.md": "- Old rule.\n" } }]);
  try {
    // Stage a change to the document itself: it is part of the change.
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    writeFileSync(`${dir}/AGENTS.md`, "- New rule.\n");
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    assert.match(readInstructions(null, dir).docs[0]!.text, /New rule/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: a git failure is no documents, never an exception", () => {
  // Not a repository at all: the tool must degrade to "no subject", not crash.
  const got = readInstructions("HEAD", "/");
  assert.deepEqual(got.docs, []);
});
```

Register the file in `test/test.ts` by adding `"instructions",` to the `files` array, after `"commits"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test instructions`
Expected: FAIL — `Cannot find module '../src/instructions.ts'`.

- [ ] **Step 3: Write the module**

Create `src/instructions.ts`:

```ts
/**
 * The instructions a repository wrote for itself, as evidence.
 *
 * `AGENTS.md` and `CLAUDE.md` say what a change is supposed to do, and
 * nothing checks them. Read here from the same tree as the diff they will
 * be held against -- `git show <sha>:AGENTS.md` for a commit, `git show
 * :AGENTS.md` for the index -- so a commit is judged by the instructions
 * that were in force when it was made, and a staged edit to the document
 * is judged as part of the change it arrives with.
 *
 * A repository with neither document produces nothing here, and a change
 * rule then produces no subject at all: a question with no standard behind
 * it is not a clean verdict, it is a question there was no ground to ask.
 */
import { execFileSync } from "node:child_process";

export interface InstructionDoc {
  file: string;
  text: string;
}

export interface Instructions {
  docs: InstructionDoc[];
  /** True when the budget cut a document short; the state has to say so. */
  truncated: boolean;
}

/** Repository root only. Nested `AGENTS.md` is deliberately out of scope. */
export const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"];

/**
 * Characters across all the documents. The diff's budget is 48,000 and a
 * state holds 32Ki of tokens; half the diff's budget leaves room for both
 * plus the questions at the measured character-to-token ratio.
 */
export const MAX_INSTRUCTION_CHARS = 24_000;

function show(ref: string | null, file: string, cwd: string): string | null {
  try {
    return execFileSync("git", ["show", `${ref ?? ""}:${file}`], {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // Absent from the tree, or not a repository. Both are "no document".
    return null;
  }
}

/**
 * Is this document just a pointer at one already read?
 *
 * `CLAUDE.md` is very often a symlink to `AGENTS.md`, which git resolves to
 * identical content, or a single line saying to read the other file. Both
 * double the tokens and say nothing twice.
 */
function isDuplicate(text: string, already: InstructionDoc[]): boolean {
  const body = text.trim();
  if (body === "") return true;
  if (already.some((d) => d.text.trim() === body)) return true;
  const lines = body.split("\n").filter((l) => l.trim() !== "");
  return lines.length === 1 && already.some((d) => lines[0]!.includes(d.file));
}

/** Cut to `limit` characters at a line boundary, never mid-sentence. */
function cut(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const at = head.lastIndexOf("\n");
  return at > 0 ? head.slice(0, at + 1) : head;
}

/**
 * The documents in the tree `ref` names, or in the index when `ref` is null.
 *
 * Order is `INSTRUCTION_FILES`, so `AGENTS.md` is the one kept whole when
 * the budget bites.
 */
export function readInstructions(ref: string | null, cwd: string = process.cwd()): Instructions {
  const docs: InstructionDoc[] = [];
  let left = MAX_INSTRUCTION_CHARS;
  let truncated = false;
  for (const file of INSTRUCTION_FILES) {
    const text = show(ref, file, cwd);
    if (text === null || isDuplicate(text, docs)) continue;
    if (left <= 0) {
      truncated = true;
      continue;
    }
    const kept = cut(text, left);
    if (kept.length < text.length) truncated = true;
    docs.push({ file, text: kept });
    left -= kept.length;
  }
  return { docs, truncated };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test instructions`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/instructions.ts test/instructions.test.ts test/test.ts
git commit -m "instructions: AGENTS.md and CLAUDE.md, read from the tree the diff belongs to

Read with \`git show <sha>:AGENTS.md\`, so a commit is judged by the
instructions that were in force when it was made rather than by today's,
and with \`git show :AGENTS.md\` for the index, so a staged edit to the
document is part of the change it arrives with.

A CLAUDE.md that is a symlink to AGENTS.md resolves to identical content
and a CLAUDE.md that is one line pointing at AGENTS.md says nothing twice;
both are dropped rather than doubling the tokens. Over 24,000 characters
the text is cut at a line boundary and the caller is told, because a model
reading a cut as an ending would read a rule that is still there as gone.

A repository with neither document yields no documents, which is not the
same as an empty one -- nothing consumes this yet, and what consumes it
will produce no subject."
```

---

## Task 3: Splitting documents into directives

**Files:**
- Create: `src/directives.ts`
- Test: `test/directives.test.ts`
- Modify: `test/test.ts`

This is pure text work with no git and no model, which is why it is its own
module and its own task.

- [ ] **Step 1: Write the failing tests**

Create `test/directives.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { splitDirectives } from "../src/directives.ts";
import { test } from "./harness.ts";

const doc = (text: string) => [{ file: "AGENTS.md", text }];

test("directives: a top-level bullet is one directive, and its children fold into it", () => {
  const got = splitDirectives(doc(`# Code

- Keep state and logic apart
  - a reducer is not a component
  - a hook is not a store
- Never use \`any\`
`));
  assert.equal(got.length, 2);
  assert.match(got[0]!.text, /Keep state and logic apart/);
  assert.match(got[0]!.text, /a reducer is not a component/, "the qualification travels with what it qualifies");
  assert.match(got[1]!.text, /Never use `any`/);
});

test("directives: the heading above is the breadcrumb, not a directive of its own", () => {
  const got = splitDirectives(doc(`# Style

## Naming

- Name a function for what it returns
`));
  assert.equal(got.length, 1, "headings are context, not instructions");
  assert.match(got[0]!.text, /Style > Naming/);
  assert.match(got[0]!.text, /Name a function for what it returns/);
});

test("directives: a paragraph outside a list is one directive", () => {
  const got = splitDirectives(doc(`Write commit messages in English.

Do not commit generated files.
`));
  assert.equal(got.length, 2);
  assert.match(got[0]!.text, /English/);
  assert.match(got[1]!.text, /generated files/);
});

test("directives: a fenced block attaches to the directive above it", () => {
  const got = splitDirectives(doc(`- Import the client like this:

\`\`\`ts
import { db } from "./db"
\`\`\`

- And nothing else
`));
  assert.equal(got.length, 2);
  assert.match(got[0]!.text, /import \{ db \}/, "the example is part of the instruction");
  assert.ok(!/import \{ db \}/.test(got[1]!.text));
});

test("directives: a blank line inside a fence does not end the directive", () => {
  const got = splitDirectives(doc(`- Use this shape:

\`\`\`ts
const a = 1

const b = 2
\`\`\`
`));
  assert.equal(got.length, 1);
  assert.match(got[0]!.text, /const b = 2/);
});

test("directives: each directive knows the file and the line it started on", () => {
  const got = splitDirectives(doc(`# Code

- First
- Second
`));
  assert.equal(got[0]!.file, "AGENTS.md");
  assert.equal(got[0]!.line, 3, "the line of the bullet, which is what a finding points at");
  assert.equal(got[1]!.line, 4);
});

test("directives: documents are split independently and keep their own names", () => {
  const got = splitDirectives([
    { file: "AGENTS.md", text: "- First\n" },
    { file: "CLAUDE.md", text: "- Second\n" },
  ]);
  assert.deepEqual(got.map((d) => d.file), ["AGENTS.md", "CLAUDE.md"]);
});

test("directives: a document of nothing but headings has no directives", () => {
  assert.deepEqual(splitDirectives(doc("# A\n\n## B\n")), []);
});
```

Register `"directives",` in `test/test.ts` beside `"instructions"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test directives`
Expected: FAIL — `Cannot find module '../src/directives.ts'`.

- [ ] **Step 3: Write the module**

Create `src/directives.ts`:

```ts
/**
 * An instruction document, split into the instructions in it.
 *
 * The first pass answers "this change breaks an instruction" over the whole
 * document, which is cheap and says nothing about which one. The second
 * pass asks one question per directive, and this is where a directive comes
 * from. Mechanical on purpose: a model asked to enumerate a document's
 * instructions would give a different list on a different day, and a cutoff
 * fitted against one list would not hold against the next.
 *
 * What counts as one directive:
 *
 * - A heading is not a directive. It is context, and it is prefixed to
 *   every directive under it as a breadcrumb, because "keep them apart"
 *   under `## Code design` and under `## Git history` are different
 *   instructions.
 * - A top-level list item is one directive, with its nested children folded
 *   into it. A nested bullet is almost always a qualification of its parent
 *   ("...but not for local variables"), and splitting them makes the parent
 *   too broad and the child unanswerable.
 * - A paragraph outside a list is one directive.
 * - A fenced code block attaches to whatever came before it, blank lines
 *   inside the fence included: the example is part of the instruction.
 */
import type { InstructionDoc } from "./instructions.ts";

export interface Directive {
  /** Which document, for the finding. */
  file: string;
  /** The line the directive starts on, 1-based, for the finding. */
  line: number;
  /** The breadcrumb and the text, which is what the model is asked about. */
  text: string;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const TOP_BULLET = /^\s{0,3}(?:[-*+]|\d+[.)])\s+\S/;
const INDENTED = /^\s+\S/;
const FENCE = /^\s{0,3}(```|~~~)/;

/** One document's directives, in the order they appear in it. */
function splitOne(doc: InstructionDoc): Directive[] {
  const lines = doc.text.split("\n");
  const out: Directive[] = [];
  // The heading stack, one entry per level, for the breadcrumb.
  const crumbs: string[] = [];
  let open: { line: number; body: string[] } | null = null;
  let fence: string | null = null;

  const close = () => {
    if (!open) return;
    const body = open.body.join("\n").replace(/\s+$/, "");
    if (body.trim() !== "") {
      const trail = crumbs.filter((c) => c !== "").join(" > ");
      out.push({ file: doc.file, line: open.line, text: trail === "" ? body : `${trail}\n${body}` });
    }
    open = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;

    // Inside a fence nothing is structure: a blank line does not end the
    // directive and a `#` is a comment, not a heading.
    if (fence !== null) {
      open?.body.push(line);
      if (line.trimStart().startsWith(fence)) fence = null;
      continue;
    }
    const fenced = FENCE.exec(line);
    if (fenced) {
      // A fence with nothing open starts a directive of its own rather than
      // being dropped; a document can open with an example.
      open ??= { line: i + 1, body: [] };
      open.body.push(line);
      fence = fenced[1]!;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      close();
      const level = heading[1]!.length;
      crumbs.length = level - 1;
      for (let d = 0; d < level - 1; d += 1) crumbs[d] ??= "";
      crumbs[level - 1] = heading[2]!.trim();
      continue;
    }

    if (line.trim() === "") {
      // A blank line ends a paragraph, but not a list item whose example or
      // sub-bullets are still to come: those are indented, and the next
      // non-blank line decides. Peek rather than close eagerly.
      const next = lines.slice(i + 1).find((l) => l.trim() !== "");
      if (next === undefined || !(INDENTED.test(next) || FENCE.test(next))) close();
      continue;
    }

    if (TOP_BULLET.test(line)) {
      close();
      open = { line: i + 1, body: [line] };
      continue;
    }

    open ??= { line: i + 1, body: [] };
    open.body.push(line);
  }
  close();
  return out;
}

/** Every document's directives, in document order. */
export function splitDirectives(docs: InstructionDoc[]): Directive[] {
  return docs.flatMap(splitOne);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test directives`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/directives.ts test/directives.test.ts test/test.ts
git commit -m "directives: an instruction document, split into the instructions in it

Mechanical on purpose. A model asked to enumerate a document's
instructions gives a different list on a different day, and a cutoff
fitted against one list would not hold against the next.

A heading is context rather than an instruction, so it becomes the
breadcrumb over the directives under it: 'keep them apart' means different
things under 'Code design' and under 'Git history'. A top-level bullet
folds its children in, because a nested bullet is nearly always a
qualification of its parent and splitting them leaves the parent too broad
and the child unanswerable. A fenced block belongs to the instruction it
illustrates, blank lines inside the fence included.

Nothing asks these yet."
```

---

## Task 4: `change` subjects from a commit range

**Files:**
- Modify: `src/types.ts` (`Subject.instructions`)
- Modify: `src/commits.ts:130-160` (`commitSubjects`)
- Test: `test/commits.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/commits.test.ts` (and add `changeRule` to the `./builders.ts` import there):

```ts
test("commits: a change rule gets the diff and the instructions; a commit rule gets neither instruction", () => {
  const dir = tempRepo([
    { message: "Set the rules", files: { "AGENTS.md": "- Never use `any`.\n" } },
    { message: "Add cart", files: { "cart.ts": "export const cart: any = {}\n" } },
  ]);
  try {
    const { subjects } = commitSubjects([commitRule(), changeRule()], "HEAD", dir);
    assert.equal(subjects.length, 4, "two commits x two rules");
    const change = subjects.find((s) => s.rule.subject === "change" && s.commit!.diff.includes("cart.ts"))!;
    assert.equal(change.nodeKind, "change");
    assert.equal(change.language, "Git");
    assert.equal(change.line, 1);
    assert.match(change.text, /1 file changed/, "the subject is the change: the stat");
    assert.ok(!/Add cart/.test(change.text), "not the message; a change rule is not about the message");
    assert.deepEqual(change.instructions!.docs.map((d) => d.file), ["AGENTS.md"]);
    assert.match(change.instructions!.docs[0]!.text, /Never use/);
    const message = subjects.find((s) => s.rule.subject === "commit" && s.text.startsWith("Add cart"))!;
    assert.equal(message.instructions, undefined, "a commit rule is judged on the message, not on the instructions");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commits: a commit with no instruction document produces no change subject", () => {
  const dir = tempRepo([{ message: "Add cart", files: { "cart.ts": "a\n" } }]);
  try {
    const { subjects } = commitSubjects([commitRule(), changeRule()], "HEAD", dir);
    assert.deepEqual(subjects.map((s) => s.rule.subject), ["commit"], "no standard, so no question: not a clean verdict");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Add the builder to `test/builders.ts`, beside `commitRule`:

```ts
export const changeRule = (over: Record<string, unknown> = {}): Rule =>
  normalizeRule({
    id: "diff-follows-instructions",
    language: "Git",
    subject: "change",
    kind: "noul",
    ask: "This change breaks one of the project's own written instructions.",
    criteria: { true: "y", false: "n" },
    at: 0.5,
    ...over,
  }).rule!;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test commits`
Expected: FAIL — `commitSubjects` makes no subject for the change rule.

- [ ] **Step 3: Add `instructions` to `Subject`**

In `src/types.ts`, beside the existing `commit?:` field on `Subject`:

```ts
  /**
   * Present on a `subject: change` subject: the instruction documents the
   * diff is judged against, read from the same tree as the diff. A change
   * subject is never built without them.
   */
  instructions?: Instructions;
```

and import the type: `import type { Instructions } from "./instructions.ts";`

- [ ] **Step 4: Build change subjects**

In `src/commits.ts`, import the reader:

```ts
import { readInstructions } from "./instructions.ts";
```

and in `commitSubjects`, replace the rule filter and the per-commit loop body:

```ts
  const commitRules = rules.filter((r) => r.subject === "commit");
  const changeRules = rules.filter((r) => r.subject === "change");
```

```ts
    if (commitRules.length === 0 && changeRules.length === 0) continue;
    const diff = commitDiff(c.sha, cwd);
    for (const rule of commitRules) {
      subjects.push({
        rule,
        file: label(c.sha),
        language: "Git",
        arm: "bare",
        text: c.message,
        line: 1,
        endLine: 1,
        nodeKind: "commit",
        enclosing: null,
        promoted: false,
        captured: { SUBJECT: c.subject },
        commit: diff,
      });
    }
    // A change subject needs a standard to be judged against. With no
    // instruction document in the tree there is none, and no subject: the
    // question would have nothing behind it, which is not a clean verdict.
    if (changeRules.length > 0) {
      const instructions = readInstructions(c.sha, cwd);
      if (instructions.docs.length > 0) {
        for (const rule of changeRules) {
          subjects.push(changeSubject(rule, label(c.sha), diff, instructions));
        }
      }
    }
```

Add the shared builder below `commitSubjects`:

```ts
/**
 * One change subject: the stat is the subject, the diff and the
 * instructions are the state.
 *
 * The subject text is the stat rather than the message, because a change
 * rule is not about the message and there may not be one -- `--staged`
 * runs before a message exists. `SUBJECT` is the stat's summary line, which
 * is what a rule refers to when it needs the size of the change.
 */
function changeSubject(rule: Rule, file: string, diff: CommitDiff, instructions: Instructions): Subject {
  const summary = diff.stat.trim().split("\n").pop() ?? "";
  return {
    rule,
    file,
    language: "Git",
    arm: "bare",
    text: diff.stat,
    line: 1,
    endLine: 1,
    nodeKind: "change",
    enclosing: null,
    promoted: false,
    captured: { SUBJECT: summary.trim() },
    commit: diff,
    instructions,
  };
}
```

Import `Instructions` in `src/commits.ts` alongside `readInstructions`.

Also widen `squashSubjects` the same way: it filters `r.subject === "commit"`; leave that filter alone (a squash is judged against a message, which is a commit rule's business) but add a comment saying so:

```ts
  // A squash is a range judged against a message someone wrote for it, which
  // is a commit rule's question. A change rule is per-change and needs no
  // message, so `commits <range>` already covers it.
  const commitRules = rules.filter((r) => r.subject === "commit");
```

- [ ] **Step 5: Let a change rule's fixtures become commits**

Three places still ask only about `subject: commit` and would leave a
change rule's suite with no subjects at all. `patchRepo` copies each
case's `before/` and `after/` trees wholesale, so a case's `AGENTS.md`
lands in the throwaway repository and `readInstructions` finds it with no
further work — only the filters need widening.

In `src/commits.ts`, `commitFixtureSubjects`:

```ts
export function commitFixtureSubjects(rules: Rule[], fixtures: string): Subject[] {
  if (!rules.some((r) => r.subject === "commit" || r.subject === "change")) return [];
```

In `src/evals.ts`, at both line 366 and line 408:

```ts
  const commitSuite = rules.some((rule) => rule.subject === "commit" || rule.subject === "change") ? patchRepo(suite.fixtures) : null;
```

Add a test to `test/evals.test.ts`:

```ts
test("evals: a change rule's fixtures become commits, each judged by its own AGENTS.md", () => {
  const suite = mkdtempSync(join(tmpdir(), "jev-change-suite-"));
  try {
    const one = join(suite, "fixtures", "forbidden");
    mkdirSync(join(one, "before"), { recursive: true });
    mkdirSync(join(one, "after"), { recursive: true });
    writeFileSync(join(one, "message"), "Colour the output\n");
    writeFileSync(join(one, "before", "AGENTS.md"), "- No runtime dependencies.\n");
    writeFileSync(join(one, "after", "AGENTS.md"), "- No runtime dependencies.\n");
    writeFileSync(join(one, "before", "package.json"), '{ "dependencies": {} }\n');
    writeFileSync(join(one, "after", "package.json"), '{ "dependencies": { "chalk": "^5" } }\n');
    const subjects = commitFixtureSubjects([changeRule()], join(suite, "fixtures"));
    assert.equal(subjects.length, 1);
    assert.match(subjects[0]!.file, /forbidden$/, "named by its case directory, which is what expect.yml keys on");
    assert.match(subjects[0]!.instructions!.docs[0]!.text, /No runtime dependencies/);
    assert.match(subjects[0]!.commit!.diff, /chalk/);
  } finally {
    rmSync(suite, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test commits && npm test evals`
Expected: PASS, including the pre-existing commits and evals tests.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/types.ts src/commits.ts src/evals.ts test/commits.test.ts test/evals.test.ts test/builders.ts
git commit -m "commits: change subjects, with the instructions that were in force

One per non-merge commit per change rule, sharing the \`git show\` the
commit rules already paid for. The subject is the stat rather than the
message: a change rule is not about the message, and \`--staged\` will run
where there is not one yet.

A commit whose tree holds neither AGENTS.md nor CLAUDE.md produces no
change subject. There is no standard to judge it against, and a question
with nothing behind it is not a clean verdict -- the same reason the
paired arm produces no subject for a file with no related test.

The eval path asked only about commit rules and would have left a change
rule's suite with no subjects at all; it now asks about both. Nothing else
there changes, because a case's trees are copied whole and its AGENTS.md
arrives with them."
```

---

## Task 5: The instructions in the state, and the question

**Files:**
- Modify: `src/state.ts:143-158`
- Modify: `src/questions.ts:113-120`
- Test: `test/state.test.ts`, `test/questions.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/state.test.ts`:

```ts
test("state: a change subject's state carries the instructions and the diff", () => {
  const rule = changeRule();
  const subject = subjectOf({
    rule,
    file: "abc",
    text: " cart.ts | 2 +-\n 1 file changed",
    nodeKind: "change",
    arm: "bare",
    language: "Git",
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
    rule,
    file: "abc",
    text: " 1 file changed",
    nodeKind: "change",
    arm: "bare",
    language: "Git",
    commit: { files: ["a.ts"], stat: " 1 file changed", diff: "d", truncated: false },
    instructions: { docs: [{ file: "AGENTS.md", text: "- One.\n" }], truncated: true },
  });
  const [batch] = planBatches([subject]);
  assert.match(String(batch!.state.note_on_instructions), /cut/);
});
```

Import `changeRule` from `./builders.ts` in that file.

Append to `test/questions.test.ts`:

```ts
test("questions: a change subject is asked about the change, never about a message", () => {
  const rule = changeRule();
  const subject = subjectOf({
    rule,
    file: "abc",
    text: " cart.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)",
    nodeKind: "change",
    arm: "bare",
    language: "Git",
    captured: { SUBJECT: "1 file changed, 1 insertion(+), 1 deletion(-)" },
    commit: { files: ["cart.ts"], stat: "s", diff: "d", truncated: false },
    instructions: { docs: [{ file: "AGENTS.md", text: "- x\n" }], truncated: false },
  });
  const q = buildQuestion(rule, subject, "s1");
  assert.equal(q.instructions.message, undefined);
  assert.match(String(q.instructions.change), /1 file changed/);
  assert.deepEqual(q.instructions.matcher_captured, { SUBJECT: "1 file changed, 1 insertion(+), 1 deletion(-)" });
  assert.equal(q.instructions.lines, undefined, "nothing matched it, so there is no line range");
});
```

Import `changeRule` there too.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test state` then `npm test questions`
Expected: FAIL — `state.instructions` undefined; `q.instructions.message` is the stat.

- [ ] **Step 3: Carry the instructions in the state**

In `src/state.ts`, in the commit branch of `buildState`, replace the block with:

```ts
  const commit = subjects[0]?.commit;
  if (commit) {
    const instructions = subjects[0]?.instructions;
    const state: StatePayload = {
      language: "Git",
      reviewing: instructions
        ? "one change: the diff is what the questions judge, and the project's own instruction documents are what it is judged against"
        : "one commit: its message is what the questions judge, and its diff is what the message is judged against",
      subjects: subjects.map((s) => ({ id: s.id, rule: s.rule?.id, node: s.nodeKind })),
      ...(instructions ? {} : { message: subjects[0]!.text }),
      files: commit.files,
      stat: commit.stat,
      diff: commit.diff,
    };
    if (instructions) state.instructions = instructions.docs;
    if (commit.truncated) {
      state.note_on_diff =
        "`diff` was cut at a hunk boundary to fit; `stat` and `files` are complete. A file or hunk absent from `diff` may still have changed.";
    }
    if (instructions?.truncated) {
      state.note_on_instructions =
        "`instructions` was cut at a line boundary to fit. Judge what is here; an instruction that is not in it may still exist, so do not read the cut as the end of the document.";
    }
    return state;
  }
```

Note `node: s.nodeKind` replaces the hard-coded `node: "commit"`, so a
change subject is indexed as `change`.

Add `instructions` and `note_on_instructions` to the `StatePayload` type in
`src/types.ts` if it is a closed shape; if it is `Record<string, unknown>`,
nothing is needed.

- [ ] **Step 4: Ask about the change, not the message**

In `src/questions.ts`, in `subjectFields`:

```ts
  // A commit or a change: nothing matched it, so no lines and no node kind.
  // Which of the two decides what the model is handed as the thing judged:
  // a commit rule judges the message, a change rule judges the change, and
  // handing a change rule a message invites it to judge that instead.
  if (subject.commit) {
    const shared: Record<string, unknown> =
      rule.subject === "change" ? { subject: id, change: subject.text } : { subject: id, message: subject.text };
    if (subject.captured && Object.keys(subject.captured).length > 0) shared.matcher_captured = subject.captured;
    return shared;
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test state && npm test questions`
Expected: PASS, with the existing commit-state tests unchanged.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/state.ts src/questions.ts test/state.test.ts test/questions.test.ts
git commit -m "state: the instructions beside the diff, and no message for a change rule

A change subject's state carries the instruction documents and says the
diff is judged against them. A cut document says so, for the same reason a
cut diff does: a model that reads the cut as the end of the document reads
an instruction that is still there as gone.

The question hands a change rule \`change\` -- the stat -- where a commit
rule gets \`message\`. Handing a rule that is not about the message a
message invites it to judge that instead, which is the failure this whole
subject kind exists to avoid."
```

---

## Task 6: `commits --staged`

**Files:**
- Modify: `src/commits.ts` (a `stagedSubjects` export)
- Modify: `src/run.ts:300-340` (the `commits` option), `src/run.ts:625-650` (`collectCommits`)
- Modify: `src/cli/targets.ts`, `src/cli/cmd-check.ts`, `src/cli/args.ts`
- Test: `test/commits.test.ts`, `test/cli.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/commits.test.ts`:

```ts
test("commits --staged: the index is one change, judged by the instructions in the index", () => {
  const dir = tempRepo([{ message: "Set the rules", files: { "AGENTS.md": "- Never use `any`.\n" } }]);
  try {
    writeFileSync(join(dir, "cart.ts"), "export const cart: any = {}\n");
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    const { subjects } = stagedSubjects([commitRule(), changeRule()], dir);
    assert.equal(subjects.length, 1, "a commit rule makes no subject: there is no message yet");
    const [s] = subjects;
    assert.equal(s!.rule.subject, "change");
    assert.equal(s!.file, "staged");
    assert.match(s!.commit!.diff, /cart\.ts/);
    assert.match(s!.instructions!.docs[0]!.text, /Never use/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commits --staged: nothing staged is no subjects, not an empty change", () => {
  const dir = tempRepo([{ message: "Set the rules", files: { "AGENTS.md": "- x\n" } }]);
  try {
    assert.deepEqual(stagedSubjects([changeRule()], dir).subjects, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Add `stagedSubjects` to the import from `../src/commits.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test commits`
Expected: FAIL — `stagedSubjects is not a function`.

- [ ] **Step 3: Build subjects from the index**

In `src/commits.ts`, add:

```ts
/**
 * What is staged, as one change.
 *
 * The pre-commit hook's subject: there is no commit and no message, so only
 * `subject: change` rules produce anything. `git diff --cached` is the
 * change and `git show :<file>` the instructions, both from the index, so a
 * staged edit to AGENTS.md is judged as part of the change it arrives with.
 */
export function stagedSubjects(rules: Rule[], cwd: string = process.cwd()): CommitSubjects {
  const changeRules = rules.filter((r) => r.subject === "change");
  if (changeRules.length === 0) return { subjects: [], commits: 0, skippedMerges: 0 };
  const diff = stagedDiff(cwd);
  if (diff.files.length === 0) return { subjects: [], commits: 0, skippedMerges: 0 };
  const instructions = readInstructions(null, cwd);
  if (instructions.docs.length === 0) return { subjects: [], commits: 1, skippedMerges: 0 };
  return {
    subjects: changeRules.map((rule) => changeSubject(rule, "staged", diff, instructions)),
    commits: 1,
    skippedMerges: 0,
  };
}

/** `commitDiff` for the index: the same caps, from `git diff --cached`. */
function stagedDiff(cwd: string, budget: number = MAX_DIFF_CHARS): CommitDiff {
  const allFiles = git(["diff", "--cached", "--name-only", "--no-ext-diff", "--no-color"], cwd)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const files =
    allFiles.length > MAX_FILES ? [...allFiles.slice(0, MAX_FILES), `… and ${allFiles.length - MAX_FILES} more files`] : allFiles;
  const statLines = git(["diff", "--cached", "--stat=100", "--no-ext-diff", "--no-color"], cwd).trim().split("\n");
  const stat =
    statLines.length > MAX_STAT_LINES
      ? [...statLines.slice(0, MAX_STAT_LINES - 1), `… ${statLines.length - MAX_STAT_LINES} more files not listed`, statLines[statLines.length - 1]!].join("\n")
      : statLines.join("\n");
  const full = git(["diff", "--cached", "--no-ext-diff", "--no-color"], cwd);
  if (full.length <= budget) return { sha: "staged", files, stat, diff: full.trimEnd(), truncated: false };
  const head = full.slice(0, budget);
  const at = Math.max(head.lastIndexOf("\ndiff --git "), head.lastIndexOf("\n@@ "));
  return { sha: "staged", files, stat, diff: (at > 0 ? head.slice(0, at) : head).trimEnd(), truncated: true };
}
```

- [ ] **Step 4: Wire it through the run**

In `src/run.ts`, widen the `commits` option:

```ts
  commits?: {
    range: string;
    label?: (sha: string) => string;
    /** Judge the whole range as one change against this message (a PR description, a changelog entry). */
    squash?: string;
    /** The index instead of a range: `subject: change` rules only, since there is no message yet. */
    staged?: boolean;
  } | null;
```

and in `collectCommits`, add the parameter and the branch:

```ts
function collectCommits(
  rules: Rule[],
  range: string,
  cwd: string,
  label?: (sha: string) => string,
  squash?: string,
  staged?: boolean,
): CollectResult & { commits: { range: string; total: number; skippedMerges: number } } {
  const { subjects, commits, skippedMerges } = staged
    ? stagedSubjects(rules, cwd)
    : squash !== undefined
      ? squashSubjects(rules, range, squash, cwd)
      : commitSubjects(rules, range, cwd, label);
```

Import `stagedSubjects`, and pass `commits.staged` at the one call site of
`collectCommits` (search for `collectCommits(` in `src/run.ts`).

- [ ] **Step 5: Wire it through the CLI**

In `src/cli/targets.ts`, in the `commits` branch, put the staged case first:

```ts
  } else if (command === "commits") {
    if (opts.staged) {
      // The index has no message, so only a change rule has anything to ask.
      if (!rules.some((r) => r.subject === "change")) {
        log("commits --staged: no `subject: change` rule is loaded; the shipped one is rules/git/diff-follows-instructions");
        return { exit: 2 };
      }
      if (opts.squash) {
        log("commits: --staged and --squash are different questions; pass one");
        return { exit: 2 };
      }
      return { paths: [], diffRanges: null, commitsRange: "staged" };
    }
    const range = rangeArg ?? (opts.base ? `${opts.base}..HEAD` : defaultRange());
```

and relax the existing rule check so a change rule also satisfies it:

```ts
    if (!rules.some((r) => r.subject === "commit" || r.subject === "change")) {
      log("commits: no `subject: commit` or `subject: change` rule is loaded; the shipped ones are rules/git/commit-message-describes-diff and rules/git/diff-follows-instructions");
      return { exit: 2 };
    }
```

In `src/cli/cmd-check.ts`, pass the flag:

```ts
    commits: commitsRange
      ? { range: commitsRange, ...(opts.squash ? { squash: opts.message! } : {}), ...(opts.staged ? { staged: true } : {}) }
      : null,
```

In `src/cli/args.ts`, add the usage lines under the commits section:

```
  jev-lint commits --staged        judge what is staged against AGENTS.md / CLAUDE.md
```

and extend the `--staged` help text:

```
      --staged             review only staged changes, as a pre-commit hook does
```
becomes
```
      --staged             review/commits: only what is staged, as a pre-commit hook does
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test commits && npm test cli`
Expected: PASS.

- [ ] **Step 7: Typecheck, run everything, commit**

```bash
npm run typecheck && npm test
git add src/commits.ts src/run.ts src/cli test/commits.test.ts
git commit -m "commits --staged: what is about to be committed, as one change

The pre-commit hook's subject. There is no commit and no message, so only
change rules produce anything, and the check in \`resolveTargets\` says so
by name rather than reporting that no commit rule is loaded.

Both sides come from the index: \`git diff --cached\` for the change and
\`git show :AGENTS.md\` for the instructions, so staging an edit to the
document makes that edit part of the change it arrives with rather than
leaving the old document to judge the new code."
```

---

## Task 7: `collect` split out of `gate`

**Files:**
- Modify: `src/gate.ts` (the `gate` function)
- Test: `test/gate.test.ts`

The attribution pass in Task 8 retracts findings after `gate` has already
counted them. Splitting the collection step out first keeps that task to one
idea.

- [ ] **Step 1: Write the failing test**

Append to `test/gate.test.ts`:

```ts
test("gate: collect re-derives the lists and the counts from findings that changed", () => {
  const subject = subjectOf();
  const gated = gate([{ subject, answer: { kind: "score", value: 3, confidence: 0.9 } }], { cutoffs: { r: 2 } });
  assert.equal(gated.stats.reported, 1);
  // Retract it the way the attribution pass does, then re-collect.
  gated.all[0]!.messageId = "review";
  gated.all[0]!.reported = false;
  const again = collect(gated.all, { cutoffs: { r: 2 }, loose: 5 });
  assert.equal(again.stats.reported, 0, "the count follows the finding");
  assert.equal(again.findings.length, 0);
  assert.equal(again.review.length, 1, "and it is in the band a reader sees");
});
```

Add `collect` to the import from `../src/gate.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test gate`
Expected: FAIL — `collect is not a function`.

- [ ] **Step 3: Split the function**

In `src/gate.ts`, replace the body of `gate` with a call to a new export:

```ts
export function gate(
  results: Array<{ subject: Subject; answer: Answer | null }>,
  options: GateOptions = {},
): GateResult {
  return collect(
    results.map(({ subject, answer }) => decide(subject, answer, options)),
    options,
  );
}

/**
 * The lists and the counts, derived from the findings.
 *
 * Separate from `gate` because a pass after the verdicts can change a
 * finding -- the attribution pass retracts one it cannot attribute -- and
 * the counts a report prints have to follow it. Deriving twice from the
 * same array is cheaper and safer than adjusting the counts by hand.
 */
export function collect(all: Finding[], options: GateOptions = {}): GateResult {
  const byMargin = (a: Finding, b: Finding) =>
    (b.margin ?? 0) - (a.margin ?? 0) || a.file.localeCompare(b.file) || a.line - b.line;
  const findings = all.filter((f) => f.reported).sort(byMargin);
  const cap = options.loose ?? 0;
  const review = all.filter((f) => f.messageId === "review").sort(byMargin).slice(0, Math.max(0, cap));
  return {
    findings,
    all,
    review,
    stats: {
      subjects: all.length,
      reported: findings.length,
      missing: all.filter((f) => f.messageId === "missing").length,
      unsure: all.filter((f) => f.messageId === "unsure").length,
      review: review.length,
      byRule: countBy(findings, (f) => f.rule),
      byFile: byFile(all, findings),
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test gate`
Expected: PASS, and every other gate test unchanged.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/gate.ts test/gate.test.ts
git commit -m "gate: collect the lists and the counts from the findings, separately

A pass after the verdicts can change a finding, and the counts a report
prints have to follow it. Deriving the lists twice from the same array is
cheaper and safer than adjusting six counters by hand at the call site."
```

---

## Task 8: The attribution pass

**Files:**
- Modify: `src/types.ts` (`Finding.violates`)
- Modify: `src/run.ts` (after the `explain` pass, around line 571)
- Test: `test/run.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/run.test.ts`:

```ts
await testAsync("run: a change finding names the instruction it is about", async () => {
  const dir = tempRepo([
    { message: "Set the rules", files: { "AGENTS.md": "# Code\n\n- Never use `any`\n- Write commits in English\n" } },
    { message: "Add cart", files: { "cart.ts": "export const cart: any = {}\n" } },
  ]);
  try {
    // The gate says yes; of the two directives only the `any` one does.
    const client = fakeClient((_instructions, question) =>
      /Never use/.test(JSON.stringify(question)) || /breaks one of/.test(String(question.statement)) ? 0.9 : 0.1,
    );
    const result = await run({
      rules: [changeRule()],
      paths: [],
      client,
      cachePath: null,
      cwd: dir,
      commits: { range: "HEAD" },
    });
    assert.equal(result.findings.length, 1);
    const [f] = result.findings;
    assert.equal(f!.violates!.length, 1, "one directive cleared its cutoff, not both");
    assert.equal(f!.violates![0]!.file, "AGENTS.md");
    assert.equal(f!.violates![0]!.line, 3);
    assert.match(f!.violates![0]!.text, /Never use/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("run: a change finding no directive accounts for is retracted to review", async () => {
  const dir = tempRepo([
    { message: "Set the rules", files: { "AGENTS.md": "- Never use `any`\n" } },
    { message: "Add cart", files: { "cart.ts": "export const cart = {}\n" } },
  ]);
  try {
    // The gate says yes and every directive says no: a violation nobody can
    // point at is not one worth printing.
    const client = fakeClient((_i, question) => (/breaks one of/.test(String(question.statement)) ? 0.9 : 0.1));
    const result = await run({
      rules: [changeRule()],
      paths: [],
      client,
      cachePath: null,
      cwd: dir,
      commits: { range: "HEAD" },
      loose: 5,
    });
    assert.equal(result.findings.length, 0, "retracted");
    assert.equal(result.stats.reported, 0, "and the count followed it");
    assert.equal(result.review.length, 1, "it is still shown to a reader in the band");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("run: the attribution pass failing leaves the finding alone rather than dropping it", async () => {
  const dir = tempRepo([
    { message: "Set the rules", files: { "AGENTS.md": "- Never use `any`\n" } },
    { message: "Add cart", files: { "cart.ts": "export const cart: any = {}\n" } },
  ]);
  try {
    let asked = 0;
    const client = fakeClient((_i, question) => {
      asked += 1;
      // The verdict answers; the attribution request throws.
      if (!/breaks one of/.test(String(question.statement))) throw new Error("529");
      return 0.9;
    });
    const result = await run({
      rules: [changeRule()],
      paths: [],
      client,
      cachePath: null,
      cwd: dir,
      commits: { range: "HEAD" },
    });
    assert.ok(asked > 1);
    assert.equal(result.findings.length, 1, "a failed follow-up never removes a finding");
    assert.equal(result.findings[0]!.violates, undefined);
    assert.ok(result.errors!.some((e) => /attribute/.test(e.error)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Import `tempRepo`, `changeRule` and `fakeClient` from `./builders.ts`,
`testAsync` from `./harness.ts`, and `rmSync` from `node:fs`, in each case
only if that file does not already import it. `test/run.test.ts` uses
`testAsync` for anything that awaits; `test(...)` there would not be
awaited and its failures would be invisible.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test run`
Expected: FAIL — `violates` is undefined and nothing is retracted.

- [ ] **Step 3: Add `violates` to `Finding`**

In `src/types.ts`, beside `explanation`:

```ts
  /**
   * Present on a `subject: change` finding: the instructions the attribution
   * pass could point at, with the answer each one got. A finding with none
   * is retracted rather than printed, so this is never empty.
   */
  violates?: Array<{ file: string; line: number; text: string; value: number }>;
```

- [ ] **Step 4: Write the pass**

In `src/run.ts`, add the imports:

```ts
import { splitDirectives } from "./directives.ts";
import { collect } from "./gate.ts";
```

(`gate` is already imported from there; add `collect` to the same clause.)

Add the function beside `explainFindings`:

```ts
/**
 * Which instruction, for a change finding.
 *
 * The verdict pass answers "this change breaks an instruction" over the
 * whole document, which is cheap and says nothing about which one. A
 * finding a reader cannot act on is not worth printing, so this pass splits
 * the documents into directives and asks one question per directive against
 * the state the verdict was asked against -- the diff and the documents are
 * already there, so it is one request per flagged change and nothing for a
 * clean one.
 *
 * A directive at or over the rule's cutoff is attached. If none is, the
 * finding is RETRACTED to `review`: the first pass is a cheap gate, and a
 * violation nobody can point at is not one worth reporting. That trades
 * recall in the first pass for precision in what is printed, deliberately.
 *
 * A failed request leaves the finding exactly as it was, attributed to
 * nothing and not retracted. Fail open: a follow-up that could not be asked
 * is not evidence that the verdict was wrong.
 */
async function attributeFindings(
  findings: Finding[],
  batches: Batch[],
  jev: AskClient,
  errors: RunError[],
  cutoffs: Record<string, number>,
): Promise<void> {
  const byIdentity = new Map<string, Finding>();
  for (const f of findings) byIdentity.set(`${f.rule}\u0000${f.file}\u0000${f.line}\u0000${f.text ?? ""}`, f);
  const jobs: Array<{ batch: Batch; asked: Array<{ subject: Subject; finding: Finding }> }> = [];
  for (const batch of batches) {
    const asked: Array<{ subject: Subject; finding: Finding }> = [];
    for (const s of batch.subjects) {
      if (s.rule.subject !== "change" || !s.instructions) continue;
      const f = byIdentity.get(identify(s));
      if (f) asked.push({ subject: s, finding: f });
    }
    if (asked.length > 0) jobs.push({ batch, asked });
  }
  await mapLimit(jobs, DEFAULT_CONCURRENCY, async ({ batch, asked }) => {
    // One numbering across the batch: `d<subject>-<n>` so two change rules
    // over the same commit cannot collide in the answer map.
    const questions: Record<string, Question> = {};
    const index: Array<{ id: string; finding: Finding; rule: Rule; directive: Directive }> = [];
    for (const { subject, finding } of asked) {
      const directives = splitDirectives(subject.instructions!.docs);
      directives.forEach((directive, n) => {
        const id = `${subject.id}-d${n}`;
        questions[id] = buildDirectiveQuestion(subject, directive, id);
        index.push({ id, finding, rule: subject.rule, directive });
      });
    }
    if (index.length === 0) return;
    try {
      const res = await jev.askSplitting(batch.state, questions);
      for (const { id, finding, rule, directive } of index) {
        const answer = readAnswer(res.answers, id);
        if (!answer || answer.value < cutoffFor(rule, cutoffs)) continue;
        (finding.violates ??= []).push({
          file: directive.file,
          line: directive.line,
          text: directive.text,
          value: answer.value,
        });
      }
      for (const { finding } of asked) {
        if (finding.violates && finding.violates.length > 0) {
          finding.violates.sort((a, b) => b.value - a.value);
          continue;
        }
        // Nothing to point at. The gate let it through and the document does
        // not account for it, so it goes to the band a reader can look at
        // rather than to the list that turns an exit code.
        finding.messageId = "review";
        finding.reported = false;
      }
    } catch (err: unknown) {
      errors.push({
        file: batch.file,
        subjects: asked.length,
        error: `attribute: ${String((err as Error)?.message ?? err)}`,
      });
    }
  });
}

/** One directive, asked against the state the verdict was asked against. */
function buildDirectiveQuestion(subject: Subject, directive: Directive, id: string): Question {
  return {
    type: "noul",
    instructions: {
      task: "Decide whether the change in the state breaks the one instruction quoted below. The instruction is the project's own; whether it is a good instruction is not the question.",
      statement: "This change does what this instruction forbids, or leaves out what it requires.",
      subject: id,
      change: subject.text,
      instruction: `${directive.file}:${directive.line}\n${directive.text}`,
      also: "An instruction about how the work was done rather than what the change contains -- how to develop, when to ask, what to read first -- cannot be checked against a diff: answer false. An instruction whose terms the change cannot be held against, and one a formatter, linter or type checker already enforces, are also false. A change that does not touch what this instruction is about is false, not unknown.",
    },
    criteria: {
      true: "The change contains something this instruction rules out, or is of a kind this instruction requires something alongside and that thing is absent from the diff.",
      false: "The change honours the instruction, does not touch what it is about, or the instruction is not one a diff can be held against.",
    },
  };
}
```

`readAnswer` is already imported in `src/run.ts:21` from `./questions.ts`
and takes the rule kind: call it `readAnswer(res.answers, id, "noul")`.
`cutoffFor` lives in `./rules.ts` — add it to whichever import clause
`src/run.ts` already has from there, or add one. Import the `Directive`
type from `./directives.ts`.

- [ ] **Step 5: Call it, and re-collect**

In `src/run.ts:570-571`, replace the two lines with:

```ts
  let gated = gate(results, { cutoffs, unsureBelow, loose });
  if (explain && !refused) await explainFindings(gated.findings, batches, jev, errors);
  if (!refused && gated.findings.length > 0) {
    await attributeFindings(gated.findings, batches, jev, errors, cutoffs);
    // The pass can retract, so the lists and the counts are derived again
    // from the findings it touched rather than adjusted by hand.
    gated = collect(gated.all, { cutoffs, unsureBelow, loose });
  }
```

`const gated` becomes `let gated`. `attributeFindings` itself returns
immediately when no batch holds a change subject, so a run with no change
rule pays one array scan and no request. The `passes > 1` block below walks
`gated.all`, which is the same array before and after `collect`, so it
needs no change.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test run`
Expected: PASS, 3 new tests, and the existing run tests unchanged.

- [ ] **Step 7: Typecheck, run everything, commit**

```bash
npm run typecheck && npm test
git add src/types.ts src/run.ts test/run.test.ts
git commit -m "run: name the instruction, or retract the finding

The verdict pass answers 'this change breaks an instruction' over the
whole document. That is cheap and says nothing a reader can act on, so a
second pass splits the documents into directives and asks one question per
directive against the state the verdict was asked against: the diff and the
documents are already in it, so it costs one request per flagged change and
nothing at all for a clean one.

A finding no directive accounts for is retracted to the review band rather
than printed. The first pass is a gate; a violation nobody can point at is
not one worth turning an exit code over. That trades recall in the first
pass for precision in what is printed, on purpose.

A failed follow-up leaves the finding exactly as it was. A question that
could not be asked is not evidence that the verdict was wrong."
```

---

## Task 9: The report prints what was violated

**Files:**
- Modify: `src/report.ts` (the pretty formatter, around line 66-85; `formatGithub` around line 387)
- Test: `test/report.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/report.test.ts`:

```ts
test("report: a change finding prints the instruction it was attributed to", () => {
  const rule = changeRule();
  const subject = subjectOf({
    rule,
    file: "abc1234567890abc1234567890abc1234567890a",
    text: " 1 file changed, 1 insertion(+)",
    nodeKind: "change",
    arm: "bare",
    language: "Git",
    commit: { files: ["cart.ts"], stat: "s", diff: "d", truncated: false },
    instructions: { docs: [{ file: "AGENTS.md", text: "- Never use `any`\n" }], truncated: false },
  });
  const finding = decide(subject, { kind: "noul", value: 0.9, confidence: null }, { cutoffs: { [rule.id]: 0.5 } });
  finding.violates = [{ file: "AGENTS.md", line: 3, text: "# Code > - Never use `any`", value: 0.88 }];
  const pretty = formatPretty(
    { rules: [rule], subjects: [subject], findings: [finding], all: [finding], review: [], undeclared: [], stats: { subjects: 1, reported: 1, missing: 0, unsure: 0, review: 0, byRule: {}, byFile: {} } },
    { color: false },
  );
  assert.match(pretty, /AGENTS\.md:3/, "the reader is told where the instruction is");
  assert.match(pretty, /Never use `any`/);
  assert.match(pretty, /0\.88/);
});
```

Import `changeRule` and `decide` in that file if not already imported.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test report`
Expected: FAIL — no `AGENTS.md:3` in the output.

- [ ] **Step 3: Print it**

In `src/report.ts`, in the per-finding loop of `formatPretty`, after the
line that pushes the dim rule/cutoff line:

```ts
      // What the finding is actually about. A change finding whose
      // instruction cannot be named was retracted before it got here, so
      // this is never the place that says "somewhere in AGENTS.md".
      for (const v of f.violates ?? []) {
        const first = v.text.split("\n").filter((l) => l.trim() !== "").pop() ?? v.text;
        out.push(`         ${c.dim(`${v.file}:${v.line}  ${v.value.toFixed(2)}`)}  ${first.trim()}`);
      }
```

In `formatGithub` (`src/report.ts:386`), the annotation body is assembled
from `where`, `num`, `why` and `cut`. Add a fifth part beside `why`:

```ts
    const cited = (f.violates ?? []).map((v) => `${v.file}:${v.line}`).join(", ");
    const breaks = cited === "" ? "" : `; breaks ${cited}`;
    const body = `${where}${f.message ?? f.ask} [${num}, cutoff ${f.at.toFixed(2)}${why}${breaks}${cut}]`;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test report`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm test
git add src/report.ts test/report.test.ts
git commit -m "report: a change finding says which instruction, and where

The last line of the directive is the one printed -- the breadcrumb above
it is context for the model, and a reader looking at AGENTS.md:3 has the
section heading in front of them already. The github format carries the
citation into the annotation, since that is all a CI reader gets."
```

---

## Task 10: The plan, for `--dry-run`

**Files:**
- Modify: `src/cli/dry-run.ts:45`, `src/cli/dry-run.ts:124`
- Test: `test/commands.test.ts`

`--dry-run` is the first command the README hands a reader, so a change
subject has to appear in it. The commit branch currently prints the message
subject and a file count.

- [ ] **Step 1: Write the failing test**

`test/commands.test.ts` runs the CLI through its own `cli(argv, client?)`
helper (`test/commands.test.ts:55`), which calls `main` with the outputs
collected and uses `process.cwd()`, so a test in another directory
`process.chdir`es and restores, as the eval test at line 156 does.

Add this shared helper near the top of the file, after `project()`:

```ts
/** A repository with an instruction document, a change rule, and a diff. */
function changeProject(): { dir: string; rules: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-change-")));
  const git = (args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir, stdio: "pipe" }).toString();
  git(["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "AGENTS.md"), "# Code\n\n- Never use `any`\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "Set the rules"]);
  writeFileSync(join(dir, "cart.ts"), "export const cart: any = {}\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "Add cart"]);
  const rules = join(dir, "change.yml");
  writeFileSync(
    rules,
    [
      "- id: diff-follows-instructions",
      "  language: Git",
      "  subject: change",
      "  kind: noul",
      "  at: 0.5",
      "  ask: This change breaks one of the project's own written instructions.",
      "  criteria: { 'true': it does, 'false': it does not }",
      "",
    ].join("\n"),
  );
  return { dir, rules };
}
```

Then the test:

```ts
await testAsync("commands: a change subject's plan names the documents it will be judged against", async () => {
  const { dir, rules } = changeProject();
  const here = process.cwd();
  try {
    process.chdir(dir);
    const dry = await cli(["commits", "HEAD", "--dry-run", "--no-config", "--cache", "none", "-R", rules, "--no-color"]);
    assert.equal(dry.code, 0, dry.log);
    assert.equal(dry.client.spent.calls, 0, "a dry run asks nothing");
    assert.match(dry.out, /vs AGENTS\.md/, "the plan says what the change will be judged against");
  } finally {
    process.chdir(here);
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test commands`
Expected: FAIL — no `AGENTS.md` in the plan.

- [ ] **Step 3: Print it**

In `src/cli/dry-run.ts`, line 45, extend the per-subject line:

```ts
      const docs = s.instructions?.docs.map((d) => d.file).join(", ");
      out(
        `  ${ref}  "${s.captured?.SUBJECT ?? ""}"  ${s.commit?.files.length ?? 0} file(s)` +
          `${s.commit?.truncated ? "  diff cut to fit" : ""}` +
          `${docs ? `  vs ${docs}` : ""}`,
      );
```

and line 124, the JSON shape:

```ts
          subjects: result.subjects.map((s) => ({
            sha: s.file,
            subject: s.captured?.SUBJECT ?? "",
            files: s.commit?.files.length ?? 0,
            truncated: s.commit?.truncated ?? false,
            ...(s.instructions ? { instructions: s.instructions.docs.map((d) => d.file) } : {}),
          })),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test commands`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm test
git add src/cli/dry-run.ts test/commands.test.ts
git commit -m "dry-run: a change subject says what it will be judged against

--dry-run is the first command the README hands a reader, and a plan that
does not name AGENTS.md leaves them guessing where the standard came
from."
```

---

## Task 11: Hook bodies under `.jev-lint/hooks/`

**Files:**
- Modify: `src/config.ts` (`initialHook`, `initialPushHook`, a new `hookShim`)
- Modify: `src/cli/cmd-init.ts` (`cmdInitHook`)
- Test: `test/config.test.ts` (the shim and the bodies), `test/commands.test.ts` (what `init` writes)

- [ ] **Step 1: Write the failing tests**

Append to `test/config.test.ts`:

```ts
test("config: the shim runs the body in the repository and exits 0 when there is none", () => {
  const shim = hookShim();
  assert.match(shim, /^#!\/bin\/sh/);
  assert.match(shim, /\.jev-lint\/hooks/);
  assert.match(shim, /exit 0/, "a shim left behind after the body is deleted must not break committing");
  assert.match(shim, /exec /);
});

test("config: the pre-commit body reviews the staged diff and judges it against the instructions", () => {
  const body = initialHook();
  assert.match(body, /review --staged --fail-on error/);
  assert.match(body, /commits --staged --fail-on error/);
  assert.match(body, /TYPESAFE_API_KEY/, "and steps aside with no key");
});
```

Append to `test/commands.test.ts`:

```ts
await testAsync("commands: init --pre-commit writes the hook into the repository and only a shim into .git/hooks", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-hook-")));
  const here = process.cwd();
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, stdio: "pipe" });
    process.chdir(dir);
    const run = await cli(["init", "--pre-commit"]);
    assert.equal(run.code, 0, run.log);
    const body = join(dir, ".jev-lint", "hooks", "pre-commit");
    assert.ok(existsSync(body), "the body is in the repository, where it is reviewed");
    assert.ok(statSync(body).mode & 0o111, "and it is executable");
    assert.match(readFileSync(body, "utf8"), /commits --staged/);
    const shim = readFileSync(join(dir, ".git", "hooks", "pre-commit"), "utf8");
    assert.match(shim, /\.jev-lint\/hooks/);
    assert.ok(!/review --staged/.test(shim), "the shim holds no policy of its own");
    // A clone that has the shim but not yet the body must still commit.
    rmSync(join(dir, ".jev-lint"), { recursive: true, force: true });
    const out = execFileSync("sh", [join(dir, ".git", "hooks", "pre-commit")], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.equal(out.trim(), "", "a missing body exits 0 and says nothing");
  } finally {
    process.chdir(here);
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Add `statSync` to the `node:fs` import at the top of
`test/commands.test.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test config && npm test commands`
Expected: FAIL — `hookShim is not a function`; the body is written into
`.git/hooks`.

- [ ] **Step 3: Write the shim and update the bodies**

In `src/config.ts`:

```ts
/**
 * What goes in git's hooks directory: nothing but a pointer.
 *
 * The body lives in the repository, where it is tracked and can be read in
 * a diff like any other file. A clone has the body and no shim, which is
 * what `init` fixes; a shim left behind after someone deleted the body must
 * not break committing, so a missing body is exit 0 and silence.
 */
export function hookShim(): string {
  return `#!/bin/sh
# jev-lint hook shim, written by \`jev-lint init\`. The hook itself is
# \`.jev-lint/hooks/<name>\` in the repository, where it can be reviewed.
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
hook="$root/.jev-lint/hooks/$(basename "$0")"
[ -x "$hook" ] || exit 0
exec "$hook" "$@"
`;
}
```

Update `initialHook` so the pre-commit body runs both checks:

```ts
export function initialHook(): string {
  return `#!/bin/sh
# jev-lint pre-commit hook, written by \`jev-lint init --pre-commit\`.
#
# Two questions about what is staged: does the code contradict what it says
# about itself, and does the change break an instruction the repository
# wrote for itself in AGENTS.md or CLAUDE.md. Prints every finding, blocks
# the commit only on a rule with \`severity: error\`. Skip it once with
# \`git commit --no-verify\`. A partially staged file is judged as it is on
# disk, since the matcher reads files, not the index.
if [ -z "$TYPESAFE_API_KEY" ] && [ -z "$TYPESAFEAI_API_KEY" ]; then
  echo "jev-lint: no API key in the environment, skipping the review" >&2
  exit 0
fi
npx -y jev-lint review --staged --fail-on error || exit $?
exec npx -y jev-lint commits --staged --fail-on error
`;
}
```

Leave `initialPushHook` as it is: `commits '@{upstream}..HEAD'` already
produces both commit and change subjects.

- [ ] **Step 4: Write the body into the repository**

In `src/cli/cmd-init.ts`, rewrite `cmdInitHook`:

```ts
export function cmdInitHook(opts: Options, out: Log, log: Log, which: "pre-commit" | "pre-push"): number {
  let hooksDir: string;
  let root: string;
  try {
    hooksDir = execFileSync("git", ["rev-parse", "--git-path", "hooks"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    log(`not inside a git repository, so there is nowhere to put a ${which} hook`);
    return 2;
  }
  // The body in the repository, where a reviewer can see it; the shim in
  // git's hooks directory, which is not tracked and never will be.
  const bodyDir = join(root, ".jev-lint", "hooks");
  const body = join(bodyDir, which);
  const shim = join(hooksDir, which);
  const line = `.jev-lint/hooks/${which}`;
  if (existsSync(body) && !opts.force) {
    log(`${body} already exists; pass --force to overwrite it`);
    return 2;
  }
  // An existing shim is only ever replaced with --force: it is probably
  // husky's or a task runner's, and the right move there is one line added
  // to it, which is printed.
  const shimExists = existsSync(shim);
  try {
    mkdirSync(bodyDir, { recursive: true });
    writeFileSync(body, which === "pre-commit" ? initialHook() : initialPushHook(), { mode: 0o755 });
    if (!shimExists || opts.force) {
      mkdirSync(hooksDir, { recursive: true });
      writeFileSync(shim, hookShim(), { mode: 0o755 });
    }
  } catch (err: unknown) {
    log(`could not write ${body}: ${String(err).slice(0, 160)}`);
    return 2;
  }
  if (opts.format === "json") {
    out(JSON.stringify({ wrote: body, shim: shimExists && !opts.force ? null : shim, hook: which }, null, 2));
    return 0;
  }
  out(`wrote ${body}`);
  if (shimExists && !opts.force) {
    out(`${shim} already exists and was left alone; add this line to it:`);
    out(`  "$(git rev-parse --show-toplevel)"/${line}`);
  } else {
    out(`and ${shim}, which runs it`);
  }
  out("");
  out("The hook is in the repository, so it is reviewed like any other file;");
  out("git's copy only points at it and exits 0 when it is not there.");
  out("");
  if (which === "pre-commit") {
    out("It reviews the staged diff and judges it against AGENTS.md / CLAUDE.md");
    out("on every commit, prints what it finds, and blocks only on a rule with");
    out("`severity: error` -- no shipped rule has it. With no API key in the");
    out("environment it steps aside. Skip it once with `git commit --no-verify`.");
  } else {
    out("It judges the commits not yet on the upstream -- does each message");
    out("describe its diff, does each change keep the project's instructions --");
    out("prints what it finds, and blocks only on a rule with `severity: error`.");
    out("With no API key, or no upstream yet, it steps aside. Skip it once with");
    out("`git push --no-verify`.");
  }
  return 0;
}
```

Add `hookShim` to the import from `../config.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test config && npm test commands`
Expected: PASS.

- [ ] **Step 6: Typecheck, run everything, commit**

```bash
npm run typecheck && npm test
git add src/config.ts src/cli/cmd-init.ts test/config.test.ts test/commands.test.ts
git commit -m "init: the hook in the repository, a shim in .git/hooks

A hook nobody can see is a hook nobody reviews. The body now goes to
\`.jev-lint/hooks/<name>\`, tracked and diffable, and git's copy is four
lines that find it and run it. A missing body exits 0 and says nothing, so
a clone that has the shim before it has the body can still commit, and a
shim left behind after someone deletes the body does not break anything.

The pre-commit body gains \`commits --staged\`, which is the question this
hook could not ask before: does the change keep the instructions the
repository wrote for itself."
```

---

## Task 12: The rule and its fixtures

**Files:**
- Create: `rules/git/diff-follows-instructions/rule.yml`
- Create: `rules/git/diff-follows-instructions/expect.yml`
- Create: `rules/git/diff-follows-instructions/fixtures/**`

No unit test here: what decides whether a rule works is its evals, which is
Task 13.

- [ ] **Step 1: Write the rule**

Create `rules/git/diff-follows-instructions/rule.yml`:

```yaml
# Changes: the instructions are the claim, the diff is the evidence.
#
# `AGENTS.md` and `CLAUDE.md` are where a repository writes down what a
# change is supposed to do, and nothing checks them. A diff that adds the
# dependency the file forbids, edits the file it calls generated, or ships
# without the test it requires passes every linter in the repository,
# because the claim it breaks is a sentence in a markdown file.
#
# `subject: change` has no matcher: `jev-lint commits <range>` builds one
# subject per non-merge commit and `jev-lint commits --staged` one from the
# index. The change is the subject, the diff and the instruction documents
# are the state, and a tree with neither document produces no subject at
# all -- a question with no standard behind it is not a clean verdict.
#
# The half of this rule that decides whether it is usable is `criteria.false`.
# An AGENTS.md is mostly instructions a diff cannot be held against: how to
# develop, when to ask, what to read first. Judged, they put every answer
# mid-scale and no cutoff separates. Named as false, they leave the ones
# with visible evidence to decide.
#
# A finding here is always attributed: the pass after the verdict asks one
# question per directive and retracts a finding no directive accounts for.

id: diff-follows-instructions
language: Git
subject: change
kind: noul
# uncalibrated -- fitted in the eval step, with the run it came from.
at: 0.7
ask: >-
  This change does something the project's own written instructions forbid,
  or leaves out something they require of a change like this one.
criteria:
  "true": >-
    The change contains something the instructions name and rule out -- a
    dependency, an API, a construct, a path, a pattern; or it edits a file
    the instructions call generated or owned elsewhere; or it is a change of
    a kind the instructions say requires something alongside it -- a test, a
    changelog entry, a type declaration, a migration -- and that thing is
    absent from the diff.
  "false": >-
    The change keeps the instructions, or does not touch what any of them is
    about. An instruction about how the work was done rather than what the
    change contains -- develop test-first, ask when unclear, read the skill
    before starting -- is not something a diff can show, and a change is not
    in breach of it here. An instruction whose terms the change cannot be
    held against ("keep it readable", "separate concerns") is the same case.
    So is an instruction a formatter, linter or type checker already
    enforces. A change that edits the instruction documents themselves is
    not in breach for doing so.
note: >-
  The instructions are the standard and the diff is the evidence. Whether an
  instruction is a good one is not the question; whether this change keeps
  it is. Wanting an instruction to have been followed is not evidence that
  it was broken: if the diff does not show the breach, the answer is false.
  `instructions` holds the documents as they were in this change's own tree,
  so an instruction added by this very change applies to it. `diff` may be
  cut to fit; `stat` and `files` are always complete, so a change visible in
  `stat` but absent from `diff` did happen.
```

- [ ] **Step 2: Build the fixtures**

Each case is `fixtures/<case>/{message,before/,after/}`, and **both trees
carry that case's own `AGENTS.md`**, so a case defines the policy it is
judged under. `patchRepo` commits `before/` then `after/` with `message`,
so a file must appear in both trees to be unchanged and in `after/` only to
be added.

The first one written out in full, as the shape for the rest:

`fixtures/forbidden-dependency/message`:

```
Colour the report output

Findings are hard to scan in a long run; the severity now carries a colour.
```

`fixtures/forbidden-dependency/before/AGENTS.md` **and**
`fixtures/forbidden-dependency/after/AGENTS.md` (identical — the policy is
not what changed):

```md
# Contributing

## Dependencies

- This CLI must run from a clean `npm install` with no runtime
  dependencies. `dependencies` in `package.json` stays empty; anything you
  need at runtime is written here or is in the standard library.
- `devDependencies` is unrestricted.

## Style

- Two-space indentation.
```

`fixtures/forbidden-dependency/before/package.json`:

```json
{
  "name": "reporter",
  "version": "1.0.0",
  "dependencies": {},
  "devDependencies": { "typescript": "^5" }
}
```

`fixtures/forbidden-dependency/after/package.json`:

```json
{
  "name": "reporter",
  "version": "1.0.0",
  "dependencies": { "chalk": "^5" },
  "devDependencies": { "typescript": "^5" }
}
```

`fixtures/forbidden-dependency/before/src/report.ts`:

```ts
export function line(severity: string, text: string): string {
  return `${severity}: ${text}`;
}
```

`fixtures/forbidden-dependency/after/src/report.ts`:

```ts
import chalk from "chalk";

export function line(severity: string, text: string): string {
  const colour = severity === "error" ? chalk.red : chalk.yellow;
  return `${colour(severity)}: ${text}`;
}
```

The remaining seven follow the same shape. Each needs a `message` that is
honest about its diff — a message that lies is the *other* rule's defect
and would confound this one — an `AGENTS.md` in both trees, and enough
source for the breach or the compliance to be visible:

Defects (the three after the one above):

2. `edits-generated-file` — `AGENTS.md` says "`src/schema.generated.ts` is written by `npm run codegen`; never edit it by hand." `after/src/schema.generated.ts` has a hand-edited field.
3. `missing-required-test` — `AGENTS.md` says "Every exported function gets a test in `test/` in the same commit." `after/src/cart.ts` exports a new `applyCoupon` and `test/` is untouched.
4. `breaks-the-instruction-it-adds` — `after/AGENTS.md` adds "Never use `any`" in the same commit whose `after/src/cart.ts` introduces `const cart: any = {}`.

Hard cleans (four):

5. `honours-the-instruction` — the same `AGENTS.md` as `missing-required-test`; `after/` exports `applyCoupon` **and** adds `test/cart.test.ts`. A lazy rule flags this.
6. `procedural-only` — an `AGENTS.md` made of "develop test-first", "ask when the instruction is unclear", "read the skill before starting"; the diff is an ordinary bug fix. Nothing here is checkable, and the answer must be false rather than mid-scale.
7. `linter-territory` — `AGENTS.md` says "Two-space indentation, single quotes, no semicolons"; `after/` adds a correctly formatted function. Deterministic tooling's job, and the change keeps it anyway.
8. `edits-the-document` — the diff only rewords `AGENTS.md` itself. Editing the instructions is not breaking them.

- [ ] **Step 3: Write `expect.yml`**

```yaml
default: clean

# bad: the change breaks an instruction the repository wrote for itself
fixtures/forbidden-dependency:
  - { line: 1, label: bad, window: 0, reason: "AGENTS.md rules out runtime dependencies; the diff adds chalk to dependencies and imports it" }
fixtures/edits-generated-file:
  - { line: 1, label: bad, window: 0, reason: "AGENTS.md says schema.generated.ts is written by codegen; the diff edits it by hand" }
fixtures/missing-required-test:
  - { line: 1, label: bad, window: 0, reason: "AGENTS.md requires a test in the same commit for a new export; applyCoupon arrives with none" }
fixtures/breaks-the-instruction-it-adds:
  - { line: 1, label: bad, window: 0, reason: "the commit adds 'never use any' to AGENTS.md and introduces `const cart: any` in the same diff" }

# hard clean: a lazy rule would flag these
fixtures/honours-the-instruction:
  - { line: 1, label: clean, window: 0, reason: "hard clean: the same new export as missing-required-test, with the test AGENTS.md requires" }
fixtures/procedural-only:
  - { line: 1, label: clean, window: 0, reason: "hard clean: every instruction is about how the work was done, which a diff cannot show" }
fixtures/linter-territory:
  - { line: 1, label: clean, window: 0, reason: "hard clean: the instructions are a formatter's job, and the change keeps them anyway" }
fixtures/edits-the-document:
  - { line: 1, label: clean, window: 0, reason: "hard clean: the diff rewords AGENTS.md; editing the instructions is not breaking them" }
```

- [ ] **Step 4: Check it loads and matches, spending nothing**

```bash
node --experimental-strip-types src/cli.ts rules -R rules/git/diff-follows-instructions/rule.yml --no-config
node --experimental-strip-types src/cli.ts commits HEAD~3..HEAD --dry-run --no-config --cache none -R rules/git/diff-follows-instructions/rule.yml --show-subjects
node --experimental-strip-types src/cli.ts eval rules/git/diff-follows-instructions --dry-run --repeat 1
```

Expected: the rule loads with no validation error; the commits dry run
lists one subject per commit with `vs AGENTS.md` beside it, or no subjects
if this repository has neither document at those commits; the eval dry run
lists eight subjects, one per fixture, and plans requests without making
any. `check --dry-run` is the wrong command here — a change rule's subjects
come from git, not from a path.

- [ ] **Step 5: Commit**

```bash
git add rules/git/diff-follows-instructions
git commit -m "rules/git: a change judged against the instructions the repository wrote

The cutoff is a guess and says so; the eval fits it next.

The half that decides whether this rule is usable is criteria.false. An
AGENTS.md is mostly instructions a diff cannot be held against -- how to
develop, when to ask, what to read first -- and judging those puts every
answer mid-scale where no cutoff separates. Named as false, they stand
aside and leave the ones with visible evidence to decide.

Eight fixtures, each carrying the AGENTS.md it is judged under, so a case
defines its own policy and the cases stay independent. Four hard cleans,
because the three ways this rule can be wrong are all false positives: a
procedural document, a formatter's instruction, and an edit to the
document itself."
```

---

## Task 13: Fit the cutoff

**Files:**
- Modify: `rules/git/diff-follows-instructions/rule.yml` (the `at:` and its comment)
- Create: `rules/git/diff-follows-instructions/baseline.json`

This step spends money and needs `TYPESAFE_API_KEY`. It is the step that
decides whether the rule works at all.

- [ ] **Step 1: Run the evals three times**

```bash
export TYPESAFE_API_KEY=...
node --experimental-strip-types src/cli.ts eval rules/git/diff-follows-instructions --repeat 3
```

Expected: a table with one row per case and a probability per case.

- [ ] **Step 2: Read every case against its diff**

For each defect that answered under 0.5, and each clean that answered over
0.5, open the fixture and decide which of the three it is (the `jev-lint`
skill, "Judging the output"): the rule is right and the fixture is wrong;
the fixture's `AGENTS.md` is vaguer than intended; or the rule's sentence
is wrong. Fix the fixture or the criteria, never the label, and re-run.

- [ ] **Step 3: Pick the cutoff**

Put `at:` between the quietest defect and the loudest clean, nearer the
loud clean when the two overlap. Replace the `# uncalibrated` comment with
the real one, in the shape `rules/git/commit-message-describes-diff/rule.yml`
uses: the date, the corpus, where the defects answered, where the cleans
topped out, the pass-to-pass spread, and why the number is where it is
rather than at the midpoint.

- [ ] **Step 4: Accept the baseline**

```bash
node --experimental-strip-types src/cli.ts eval rules/git/diff-follows-instructions --repeat 3 --accept
```

Expected: `baseline.json` written, precision and recall printed.

- [ ] **Step 5: Run it on unseen changes**

```bash
node --experimental-strip-types src/cli.ts commits HEAD~12..HEAD --no-config --cache none -R rules/git/diff-follows-instructions/rule.yml --retry 3 --record /tmp/instructions.json
```

Read every finding against its commit. Record what the residue is — the
findings you disagree with and why — in the `at:` comment, the way the
commit rule's does.

- [ ] **Step 6: Commit**

```bash
git add rules/git/diff-follows-instructions
git commit -m "rules/git: fit diff-follows-instructions, and say what the residue is

<the numbers from the run: where the defects answered, where the cleans
topped out, the spread, why the cutoff sits where it does, and what it
misses on this repository's own last twelve commits>"
```

---

## Task 14: Turn it on, and document it

**Files:**
- Modify: `.jev-lint.yaml`, `RULES.md`, `README.md`, `README-ja.md`, `CHANGELOG.md`
- Modify: `docs/reference.md` (the commits section)

- [ ] **Step 1: Regenerate RULES.md and turn the rule on**

```bash
npm run rules:md
```

Add to `.jev-lint.yaml`'s `rules:`, in alphabetical order:

```yaml
  diff-follows-instructions: on
```

- [ ] **Step 2: Document the subject and the command**

In `docs/reference.md`, in the commits section, add what `subject: change`
is, where the instruction documents come from, that a tree with neither
produces no subject, and what `commits --staged` does.

In `README.md` and `README-ja.md`, add `jev-lint commits --staged` to the
command list and one sentence on the rule beside the commit-message one.

- [ ] **Step 3: Write the changelog entry**

Under `## Unreleased` in `CHANGELOG.md`, in the style of the entries
around it: what the defect class is, what was added, the measured numbers
from Task 13, and what it deliberately does not judge.

- [ ] **Step 4: Verify the whole thing on this repository**

```bash
npm run ci
node --experimental-strip-types src/cli.ts commits HEAD~3..HEAD --dry-run
node --experimental-strip-types src/cli.ts init --pre-commit
git diff --stat
```

Expected: `npm run ci` green; the dry run names `AGENTS.md` or `CLAUDE.md`
if this repository has one and otherwise reports no change subjects; `init`
writes `.jev-lint/hooks/pre-commit` and a shim.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: the instructions rule, commits --staged, and hooks in the repository"
```

---

## Notes for whoever executes this

- **Read the rule's own skill first.** `.claude/skills/jev-lint/SKILL.md`, and
  `references/calibration.md` before Task 13. A rule with a guessed cutoff
  and no accepted baseline is not a rule that ships.
- **Task 13 is the one that can fail.** Tasks 1-12 are plumbing and either
  compile or do not. If the evals will not separate — every case mid-scale,
  no cutoff between the defects and the cleans — the problem is almost
  always `criteria.false` not naming the unverifiable instructions clearly
  enough, or a fixture's `AGENTS.md` being vaguer than the case needed.
  Fix the wording or the fixture; do not move the labels.
- **`npm test <substring>`** runs one file. `npm run ci` runs typecheck,
  tests, build and `eval --replay` and is what must be green before a push.
- The pre-push hook in this repository judges the commits about to leave,
  so the commit messages above are written to survive being read by it:
  each says what the diff does, including the parts the subject line does
  not name.
