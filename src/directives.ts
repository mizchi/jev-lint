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
 * - A top-level list item -- a marker flush against the left margin, with
 *   no leading whitespace -- is one directive, with everything indented
 *   under it (nested bullets, wrapped continuation lines, an attached
 *   example) folded in. A nested bullet is almost always a qualification
 *   of its parent ("...but not for local variables"), and splitting them
 *   makes the parent too broad and the child unanswerable. The marker must
 *   be at column 0: CommonMark itself tolerates up to three leading spaces
 *   on a list marker before it stops being "the same list", but a directive
 *   here is only ever told apart from its own children by indentation, so
 *   this cannot also allow the top-level marker to be indented -- an
 *   AGENTS.md that writes its top-level bullets a few spaces in would have
 *   every line matched as a fresh directive instead of one with children.
 * - A paragraph outside a list is one directive.
 * - A fenced code block attaches to whatever came before it, blank lines
 *   inside the fence included: the example is part of the instruction. A
 *   document that ends without closing its last fence still closes that
 *   directive, at end of input, with whatever the fence contained.
 *
 * Two things this does not get right, on purpose, because fixing them isn't
 * worth what it would cost:
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
 */
import type { InstructionDoc } from "./instructions.ts";

export interface Directive {
  /** Which document, for the finding. */
  file: string;
  /** The line the directive starts on, 1-based, for the finding. */
  line: number;
  /**
   * The breadcrumb (if any) and the body, joined by one newline, which is
   * what the model is asked about. There is no delimiter a consumer can
   * split on to recover the breadcrumb and the body separately -- " > " is
   * also legal text inside a directive's own body -- so a reader that wants
   * to print just the instruction has to re-derive the breadcrumb itself,
   * or this type needs a `breadcrumb` field split out from `body`. Nothing
   * in this task reads `text` for display; the next task that wants to
   * print these in a report should split the fields instead of parsing
   * this string back apart.
   */
  text: string;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
// Anchored at column 0 on purpose -- see the module comment above.
const TOP_BULLET = /^(?:[-*+]|\d+[.)])\s+\S/;
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
      // A heading can skip levels (`#` then `###`, no `##` between). The
      // skipped slot is left `undefined`, then padded to `""` so a later
      // heading at that level has something to overwrite; `close()`'s
      // `filter((c) => c !== "")` drops the empty slot from the breadcrumb,
      // so a skipped level costs no stray separator. Truncating to
      // `level - 1` before the pad is also what makes a shallower heading
      // later correctly drop a deeper one it never closed itself.
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
