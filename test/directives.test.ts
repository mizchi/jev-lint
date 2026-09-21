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
  assert.match(got[0]!.body, /Keep state and logic apart/);
  assert.match(got[0]!.body, /a reducer is not a component/, "the qualification travels with what it qualifies");
  assert.match(got[1]!.body, /Never use `any`/);
});

test("directives: the heading above is the breadcrumb, not a directive of its own", () => {
  const got = splitDirectives(doc(`# Style

## Naming

- Name a function for what it returns
`));
  assert.equal(got.length, 1, "headings are context, not instructions");
  assert.match(got[0]!.breadcrumb, /Style > Naming/);
  assert.match(got[0]!.body, /Name a function for what it returns/);
});

test("directives: a paragraph outside a list is one directive", () => {
  const got = splitDirectives(doc(`Write commit messages in English.

Do not commit generated files.
`));
  assert.equal(got.length, 2);
  assert.match(got[0]!.body, /English/);
  assert.match(got[1]!.body, /generated files/);
});

test("directives: a fenced block attaches to the directive above it", () => {
  const got = splitDirectives(doc(`- Import the client like this:

\`\`\`ts
import { db } from "./db"
\`\`\`

- And nothing else
`));
  assert.equal(got.length, 2);
  assert.match(got[0]!.body, /import \{ db \}/, "the example is part of the instruction");
  assert.ok(!/import \{ db \}/.test(got[1]!.body));
});

test("directives: a blank line inside a fence does not end the directive", () => {
  const got = splitDirectives(doc(`- Use this shape:

\`\`\`ts
const a = 1

const b = 2
\`\`\`
`));
  assert.equal(got.length, 1);
  assert.match(got[0]!.body, /const b = 2/);
});

test("directives: each directive knows the file and the line it started on", () => {
  const got = splitDirectives(doc(`# Code

- First
- Second
`));
  assert.equal(got.length, 2, "would still pass with a spurious third directive if this weren't checked");
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

// --- Probing branches the eight tests above never reach. ---

test("directives: a heading that skips levels still drops on a shallower heading", () => {
  // `# A` then `### B` opens at level 3 with nothing at level 2. The
  // missing level does not leave a stray separator in the breadcrumb, and
  // a later `## C` correctly drops the deeper `### B` it never closed.
  const got = splitDirectives(doc(`# A

### B

- one

## C

- two
`));
  assert.equal(got.length, 2);
  assert.equal(got[0]!.breadcrumb, "A > B");
  assert.equal(got[1]!.breadcrumb, "A > C");
});

test("directives: a document ending mid-fence still closes its last directive", () => {
  const got = splitDirectives(doc(`- Use this:

\`\`\`ts
const a = 1
`));
  assert.equal(got.length, 1);
  assert.match(got[0]!.body, /const a = 1/);
});

test("directives: a longer closing fence also closes a backtick fence, CommonMark or not", () => {
  // A closing fence only has to start with the same marker character the
  // opener used; it does not have to match the opener's length. A stray
  // four-backtick line closes a three-backtick fence here, unlike
  // CommonMark, which would leave the fence open and pull the following
  // paragraph into the example instead of starting a new directive.
  const got = splitDirectives(doc(`- Use this:

\`\`\`ts
const a = 1
\`\`\`\`

- Unrelated
`));
  assert.equal(got.length, 2);
  assert.ok(!/Unrelated/.test(got[0]!.body));
});

test("directives: sub-bullets separated from their parent by a blank line still fold in", () => {
  const got = splitDirectives(doc(`- Keep them apart

  - a reducer is not a component
`));
  assert.equal(got.length, 1);
  assert.match(got[0]!.body, /a reducer is not a component/);
});

test("directives: a paragraph followed by a blank line and an indented non-list line is one directive", () => {
  const got = splitDirectives(doc(`Some intro text.

    still indented, not a new paragraph
`));
  assert.equal(got.length, 1);
  assert.match(got[0]!.body, /still indented/);
});

test("directives: a uniformly-indented top-level list is still one directive per bullet", () => {
  // Regression: the first implementation anchored the bullet marker at
  // column 0, so an AGENTS.md that writes its top-level bullets a few
  // spaces in had every sibling read as one bullet's indented child --
  // three independent rules silently merged into one directive. Each
  // bullet here is now compared against the indentation of the one that
  // opened the currently open directive, not against zero, so a sibling
  // at the same indentation still closes and starts a new directive.
  const got = splitDirectives(doc(`# Rules

  - First rule, indented two spaces
  - Second rule, indented two spaces
  - Third rule, indented two spaces
`));
  assert.equal(got.length, 3);
  assert.match(got[0]!.body, /First rule/);
  assert.match(got[1]!.body, /Second rule/);
  assert.match(got[2]!.body, /Third rule/);
});

test("directives: an indented top-level list still folds each item's own deeper children", () => {
  const got = splitDirectives(doc(`  - a
  - b
    - b's child
`));
  assert.equal(got.length, 2);
  assert.doesNotMatch(got[0]!.body, /b's child/, "a's sibling b does not fold into a");
  assert.match(got[1]!.body, /b's child/, "b's own child, indented past b, folds into b");
});

// --- Round 3: CRLF, lead-in paragraphs, noise rejection, and the branches
// a reviewer had to construct by hand rather than run. ---

test("directives: a CRLF document still finds the heading, not a bare `#` line", () => {
  const got = splitDirectives(doc("# Rules\r\n\r\n- one\r\n"));
  assert.equal(got.length, 1);
  assert.equal(got[0]!.breadcrumb, "Rules");
  assert.match(got[0]!.body, /one/);
  assert.ok(!/\r/.test(got[0]!.body), "the trailing \\r a CRLF line leaves behind does not leak into the body");
});

test("directives: a closing ATX sequence does not leak into the breadcrumb", () => {
  const got = splitDirectives(doc("## Design ###\n\n- a\n"));
  assert.equal(got[0]!.breadcrumb, "Design");
});

test("directives: a colon-terminated paragraph immediately before a list becomes every item's breadcrumb", () => {
  // The real case this exists for: a list item that only makes sense next
  // to the sentence introducing it.
  const got = splitDirectives(doc(`新規 skill を作るとき、配置先を次の指針で決める:

- **project 固有**: 特定 repo のドメイン知識に依存し、他 repo で使う見込みがない
- **グローバル**: 言語・ツール横断、複数 repo で再利用可能
- **判断不能なとき**: ユーザーに「project 固有かグローバルか」を質問してから作成
`));
  assert.equal(got.length, 3);
  for (const d of got) {
    assert.match(d.breadcrumb, /次の指針で決める:$/, "the lead-in travels with every item in the list it introduces, not just the first");
  }
  assert.doesNotMatch(got[0]!.body, /次の指針で決める/, "the lead-in lives in the breadcrumb, not duplicated into the body");
});

test("directives: a lead-in's scope ends with the list, and does not leak into what follows", () => {
  const got = splitDirectives(doc(`Decide like this:

- one
- two

Unrelated paragraph after the list.
`));
  assert.equal(got.length, 3);
  assert.match(got[0]!.breadcrumb, /Decide like this:/);
  assert.match(got[1]!.breadcrumb, /Decide like this:/);
  assert.equal(got[2]!.breadcrumb, "", "the lead-in does not leak past the list it introduced");
});

test("directives: a lead-in does not chain across an unrelated paragraph in between", () => {
  const got = splitDirectives(doc(`First paragraph, not immediately before the list.

Second paragraph, immediately before the list:

- one
`));
  assert.equal(got.length, 2, "the first paragraph became a directive; only the second became a lead-in");
  assert.equal(got[0]!.breadcrumb, "");
  assert.match(got[0]!.body, /First paragraph/);
  assert.match(got[1]!.breadcrumb, /Second paragraph, immediately before the list:/);
  assert.doesNotMatch(got[1]!.breadcrumb, /First paragraph/, "lead-ins do not chain -- only the immediately preceding paragraph carries forward");
});

test("directives: a thematic break is not a directive", () => {
  const got = splitDirectives(doc("Some text.\n\n---\n\nMore text.\n"));
  assert.deepEqual(got.map((d) => d.body), ["Some text.", "More text."]);
});

test("directives: a body that is only an HTML comment is not a directive", () => {
  const got = splitDirectives(doc("Some text.\n\n<!-- TODO: revisit -->\n\nMore text.\n"));
  assert.deepEqual(got.map((d) => d.body), ["Some text.", "More text."]);
});

test("directives: a setext heading is not recognised as a heading (documented, not fixed)", () => {
  const got = splitDirectives(doc(`Code design
===========

- a
`));
  assert.equal(got.length, 2);
  assert.match(got[0]!.body, /Code design/);
  assert.match(got[0]!.body, /===========/, "the underline is parsed as body text, not a heading marker");
  assert.equal(got[1]!.breadcrumb, "", "no breadcrumb -- a setext heading was never recognised as a heading at all");
});

test("directives: a document that opens with a fence is one directive built from it", () => {
  const got = splitDirectives(doc("```ts\nconst a = 1\n```\n"));
  assert.equal(got.length, 1);
  assert.match(got[0]!.body, /const a = 1/);
});

test("directives: a bullet immediately after a paragraph, no blank line between, still starts its own directive", () => {
  const got = splitDirectives(doc("Some text.\n- a bullet\n"));
  assert.equal(got.length, 2, "the paragraph does not end in \":\", so it is a directive, not a lead-in");
  assert.match(got[0]!.body, /Some text/);
  assert.match(got[1]!.body, /a bullet/);
});

test("directives: a bullet at indent 0 following a deeply nested one still starts a new directive", () => {
  const got = splitDirectives(doc(`- a
    - a's deeply nested child
- b
`));
  assert.equal(got.length, 2);
  assert.match(got[0]!.body, /a's deeply nested child/);
  assert.doesNotMatch(got[1]!.body, /a's deeply nested child/);
});

test("directives: a tab-indented child under a wider space-indented parent does not fold in (documented, not fixed)", () => {
  // A tab counts as one character of indentation, same as one space, so
  // "one tab" (indentation 1) is not deeper than the four-space parent
  // (indentation 4) and splits into its own directive instead of folding.
  const got = splitDirectives(doc("    - four spaces\n\t- one tab\n"));
  assert.equal(got.length, 2);
});
