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

// --- Probing branches the eight tests above never reach. ---

test("directives: a heading that skips levels still drops on a shallower heading", () => {
  // `# A` then `### B` opens at level 3 with nothing at level 2. The crumb
  // stack is padded with "" for the missing level, and a later `## C`
  // truncates back to level 2, which must drop the `### B` crumb rather
  // than leaving a stale entry the truncation missed.
  const got = splitDirectives(doc(`# A

### B

- one

## C

- two
`));
  assert.equal(got.length, 2);
  // crumbs.filter((c) => c !== "") drops the padded, never-set level-2 slot,
  // so the missing heading does not show up as a doubled separator.
  assert.match(got[0]!.text, /^A > B/);
  assert.match(got[1]!.text, /^A > C/);
  assert.ok(!/B/.test(got[1]!.text));
});

test("directives: a document ending mid-fence still closes its last directive", () => {
  const got = splitDirectives(doc(`- Use this:

\`\`\`ts
const a = 1
`));
  assert.equal(got.length, 1);
  assert.match(got[0]!.text, /const a = 1/);
});

test("directives: a longer closing fence also closes a backtick fence, CommonMark or not", () => {
  // FENCE captures only the marker character run at open ("```"), and close
  // is a startsWith check against that captured string -- so a line with
  // FOUR backticks still satisfies startsWith("```") and closes it, unlike
  // CommonMark, which requires the closer be at least as long and would
  // leave this fence open (making the next paragraph part of the example).
  const got = splitDirectives(doc(`- Use this:

\`\`\`ts
const a = 1
\`\`\`\`

- Unrelated
`));
  assert.equal(got.length, 2);
  assert.ok(!/Unrelated/.test(got[0]!.text));
});

test("directives: sub-bullets separated from their parent by a blank line still fold in", () => {
  const got = splitDirectives(doc(`- Keep them apart

  - a reducer is not a component
`));
  assert.equal(got.length, 1);
  assert.match(got[0]!.text, /a reducer is not a component/);
});

test("directives: a paragraph followed by a blank line and an indented non-list line is one directive", () => {
  const got = splitDirectives(doc(`Some intro text.

    still indented, not a new paragraph
`));
  assert.equal(got.length, 1);
  assert.match(got[0]!.text, /still indented/);
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
  assert.match(got[0]!.text, /First rule/);
  assert.match(got[1]!.text, /Second rule/);
  assert.match(got[2]!.text, /Third rule/);
});

test("directives: an indented top-level list still folds each item's own deeper children", () => {
  const got = splitDirectives(doc(`  - a
  - b
    - b's child
`));
  assert.equal(got.length, 2);
  assert.doesNotMatch(got[0]!.text, /b's child/, "a's sibling b does not fold into a");
  assert.match(got[1]!.text, /b's child/, "b's own child, indented past b, folds into b");
});
