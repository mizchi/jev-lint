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
 * - A list item is one directive. A sibling bullet -- one at the same or
 *   shallower indentation than the bullet that opened the current
 *   directive -- closes it and starts a new one; a bullet indented
 *   strictly deeper folds in, because a nested bullet is almost always a
 *   qualification of its parent ("...but not for local variables") and
 *   splitting them would leave the parent too broad and the child
 *   unanswerable. "Strictly deeper" governs bullets only -- a wrapped
 *   continuation line or an attached example folds in at any indentation,
 *   including flush left, because the rule for anything that is not a
 *   bullet or a heading is simply "append it to whatever directive is
 *   open"; indentation never enters into that decision. Comparing a
 *   bullet's own indentation against the bullet that opened the current
 *   directive, rather than against column 0, is what makes this work when
 *   a whole list is itself indented: an AGENTS.md whose top-level bullets
 *   all sit two spaces in still gets one directive per bullet, because
 *   each is compared against the one before it, not against zero.
 * - A paragraph outside a list is one directive -- unless it ends in ":"
 *   and sits immediately before a list, with or without a blank line
 *   between them, in which case it is not a directive of its own. It
 *   becomes part of the `breadcrumb` of every item in the list it
 *   introduces, the same way a heading does, because a list item like
 *   "**判断不能なとき**: ask the user" is unanswerable without the
 *   sentence above it that says what is being decided. The lead-in's
 *   scope ends with the list -- it is not carried into whatever follows --
 *   and it does not chain: only the paragraph immediately before the list
 *   counts, not an earlier one separated from the list by something else.
 * - A fenced code block attaches to whatever came before it, blank lines
 *   inside the fence included: the example is part of the instruction. A
 *   document that ends without closing its last fence still closes that
 *   directive, at end of input, with whatever the fence contained.
 * - A body that is nothing but `-`, `=`, `*`, `_`, `|` and whitespace -- a
 *   thematic break, a setext heading's underline, a table's separator row
 *   -- or nothing but an HTML comment, is not a directive: there is no
 *   instruction in it, and the second pass would spend a model call asking
 *   a meaningless question about punctuation. A markdown table's header
 *   and data rows, and YAML front matter, are NOT filtered here -- catching
 *   those costs more than a one-line check buys, so they still ship as
 *   (uninformative) directives.
 *
 * What this does not get right, on purpose, because fixing it isn't worth
 * what it would cost:
 *
 * - The fence closer is checked with `startsWith`, not an exact-or-longer
 *   match against the opening run's length. CommonMark says a fence only
 *   closes on a run of the same character at least as long as the one that
 *   opened it; here, a stray line of four backticks closes a three-backtick
 *   fence just as well as three would. A document whose examples mix fence
 *   lengths is not one this has been asked to parse correctly.
 * - The line after a blank one is found with `lines.slice(i + 1).find(...)`,
 *   which rescans the rest of the document from every blank line -- O(n)
 *   per blank line. Measured against `MAX_INSTRUCTION_CHARS` (16,000, see
 *   `src/instructions.ts`) with a worst-case document of nothing but short
 *   bullets separated by blank lines, this runs in under 1ms; even at
 *   128,000 characters, eight times over budget, it's under 10ms. Not worth
 *   rewriting into a single forward pass for a input this small.
 * - A setext heading (`Heading` on one line, `===` or `---` immediately
 *   under it) is not recognised as a heading at all. It falls through like
 *   a plain paragraph: the heading text ships as an ordinary directive
 *   (its underline, being pure punctuation, is dropped by the noise filter
 *   above, but the text itself is not), and it never becomes a breadcrumb
 *   for what follows it. Only ATX headings (`#` through `######`) are
 *   recognised.
 * - A tab counts as one character of indentation, the same as one space: a
 *   tab-indented child under a four-space parent has indentation 1, not
 *   deeper than the parent's 4, and splits into its own directive instead
 *   of folding in. Documented, not fixed -- an instruction document that
 *   mixes tabs and spaces for list indentation is not a shape this has
 *   been asked to parse correctly.
 * - `FENCE` only recognises a fence marker indented 0-3 spaces, matching
 *   CommonMark's own limit for when a fence stops belonging to a list and
 *   becomes indented code -- but nothing here tracks "the surrounding
 *   list's own indentation", so a fence nested two list levels deep is
 *   just ordinary indented text to this parser. It still folds into
 *   whatever directive is open, through the same plain "append it"
 *   fallthrough that handles any other continuation line, so nothing
 *   breaks -- it is simply not treated as a fence, and a blank line inside
 *   it is not specially protected the way one inside a recognised fence
 *   is.
 */
import type { InstructionDoc } from "./instructions.ts";

export interface Directive {
  /** Which document, for the finding. */
  file: string;
  /** The line the directive starts on, 1-based, for the finding. */
  line: number;
  /**
   * The headings above this directive, and any colon-terminated paragraph
   * immediately introducing the list it belongs to, joined by " > " in the
   * order they apply -- headings outermost, the list's lead-in last. "" at
   * the top level, with no heading and no lead-in.
   */
  breadcrumb: string;
  /**
   * The instruction itself: the bullet or paragraph text, and anything
   * folded into it (nested bullets, a wrapped continuation, an attached
   * example), without the breadcrumb.
   */
  body: string;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
// The leading whitespace is captured, not bounded to 0-3: CommonMark's
// 0-3 is about when a marker stops belonging to an enclosing list, which
// is not the question here. The question here is answered by comparing
// this capture against the indentation of whichever bullet is currently
// open -- see the module comment.
const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+\S/;
const INDENTED = /^\s+\S/;
const FENCE = /^\s{0,3}(```|~~~)/;

/** A body with no instruction in it: pure separator punctuation, or nothing
 * but an HTML comment. See the module comment's "what this rejects" bullet. */
function isNoise(body: string): boolean {
  const trimmed = body.trim();
  if (/^[-=*_|\s]+$/.test(trimmed)) return true;
  if (/^<!--[\s\S]*-->$/.test(trimmed)) return true;
  return false;
}

/** One document's directives, in the order they appear in it. */
function splitOne(doc: InstructionDoc): Directive[] {
  // A line ending is normalised to bare "\n" before anything else looks at
  // it. `git show` hands back a blob verbatim, so a repository committed
  // on Windows without `core.autocrlf` produces CRLF lines, and `HEADING`
  // (`.` excludes `\r`, `$` is not multiline) would otherwise never match
  // a heading in it at all -- every heading ships as a directive instead
  // of becoming a breadcrumb, silently, for the whole document.
  const lines = doc.text.split("\n").map((l) => l.replace(/\r$/, ""));
  const out: Directive[] = [];
  // The heading stack, one entry per level, for the breadcrumb.
  const crumbs: string[] = [];
  let open: { line: number; body: string[] } | null = null;
  // What opened `open`, so a bullet closing it can tell "this was a
  // sibling bullet" from "this was a colon-terminated paragraph, about to
  // become the list's lead-in" from "this was a fence, leave it alone".
  let openKind: "bullet" | "para" | "fence" | null = null;
  // The indentation of the bullet that opened `open`, or null when `open`
  // was opened by a paragraph or a fence instead of a bullet. A `null`
  // here means the next bullet line always closes `open` rather than
  // folding into it -- a bullet is never a child of a paragraph.
  let openBulletIndent: number | null = null;
  // A colon-terminated paragraph that closed immediately before a list,
  // carried forward into every list item's breadcrumb until the list ends.
  let leadIn: string | null = null;
  let fence: string | null = null;

  const close = (keepLeadIn = false) => {
    if (open) {
      const body = open.body.join("\n").replace(/\s+$/, "");
      if (body.trim() !== "" && !isNoise(body)) {
        const parts = crumbs.filter((c) => c !== "");
        if (leadIn !== null) parts.push(leadIn);
        out.push({ file: doc.file, line: open.line, breadcrumb: parts.join(" > "), body });
      }
    }
    open = null;
    openKind = null;
    openBulletIndent = null;
    if (!keepLeadIn) leadIn = null;
  };

  // Closes whatever is open, knowing a bullet either is the current line
  // (`nextIsBullet` always true, called from the bullet branch) or is the
  // next non-blank line (called from the blank-line branch). A
  // colon-terminated paragraph closing this way becomes the list's
  // lead-in instead of a directive of its own; anything else closing this
  // way (a sibling bullet, ending its own turn) keeps the lead-in alive
  // for the item about to open. Nothing open and a bullet still coming
  // means the lead-in, if any, is mid-list and stays untouched.
  const closeBeforeList = (nextIsBullet: boolean) => {
    if (!open) {
      if (!nextIsBullet) leadIn = null;
      return;
    }
    if (nextIsBullet && openKind === "para") {
      const body = open.body.join("\n").replace(/\s+$/, "").trim();
      if (body.endsWith(":")) {
        leadIn = body;
        open = null;
        openKind = null;
        openBulletIndent = null;
        return;
      }
    }
    close(nextIsBullet);
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
      if (!open) {
        open = { line: i + 1, body: [] };
        openKind = "fence";
      }
      open.body.push(line);
      fence = fenced[1]!;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      close();
      const level = heading[1]!.length;
      // A heading can skip levels (`#` then `###`, no `##` between). The
      // skipped slot is left `undefined`, then padded to `""` so a later
      // heading at that level has something to overwrite; `close()`'s
      // filter over `crumbs` drops the empty slot from the breadcrumb, so
      // a skipped level costs no stray separator. Truncating to
      // `level - 1` before the pad is also what makes a shallower heading
      // later correctly drop a deeper one it never closed itself.
      crumbs.length = level - 1;
      for (let d = 0; d < level - 1; d += 1) crumbs[d] ??= "";
      // A closing ATX sequence (`## Design ###`) is decoration, not title.
      crumbs[level - 1] = heading[2]!.trim().replace(/\s+#+$/, "");
      continue;
    }

    if (line.trim() === "") {
      // A blank line ends a paragraph, but not a list item whose example or
      // sub-bullets are still to come: those are indented, and the next
      // non-blank line decides. Peek rather than close eagerly.
      const next = lines.slice(i + 1).find((l) => l.trim() !== "");
      if (next !== undefined && (INDENTED.test(next) || FENCE.test(next))) continue;
      closeBeforeList(next !== undefined && BULLET.test(next));
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      const indent = bullet[1]!.length;
      // Strictly deeper than the bullet that opened the current directive
      // folds in; at or shallower closes it and starts a fresh one at this
      // indentation. `openBulletIndent === null` (opened by a paragraph or
      // a fence) always takes the close-and-open branch.
      if (open && openBulletIndent !== null && indent > openBulletIndent) {
        open.body.push(line);
        continue;
      }
      closeBeforeList(true);
      open = { line: i + 1, body: [line] };
      openKind = "bullet";
      openBulletIndent = indent;
      continue;
    }

    if (!open) {
      open = { line: i + 1, body: [] };
      openKind = "para";
    }
    open.body.push(line);
  }
  close();
  return out;
}

/** Every document's directives, in document order. */
export function splitDirectives(docs: InstructionDoc[]): Directive[] {
  return docs.flatMap(splitOne);
}
