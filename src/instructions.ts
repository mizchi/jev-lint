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
 * A repository with neither document produces nothing here: a question
 * judged against no standard is not a clean verdict, it is a question
 * there was no ground to ask.
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
export const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

/**
 * Characters across all the documents.
 *
 * Reasoned against `STATE_BUDGET` (`src/batch.ts`), not the raw
 * `MAX_STATE_TOKENS` ceiling: a change subject is `arm: "bare"`, and a
 * one-subject batch cannot be split to recover from an overrun the way a
 * batch of many subjects can, so there is no step-down here to absorb a
 * budget picked too generously.
 *
 * Measured with this repository's own `estimateTokens`, at the sibling
 * caps a change's diff state already uses -- `MAX_DIFF_CHARS` 48,000 of
 * diff, `MAX_STAT_LINES` 120 stat lines, `MAX_FILES` 200 file paths --
 * plus a commit message and the one-subject wrapper, with real source from
 * this repository standing in for the diff so the quote-and-brace density
 * is this codebase's own rather than guessed:
 *
 *   STATE_BUDGET            26,214 tokens (MAX_STATE_TOKENS 32,768 / 1.25)
 *   worst case, no docs     20,264 tokens
 *   16,000 chars of docs     4,777 tokens  -> total 25,048, margin 1,166
 *   20,000 chars of docs     5,962 tokens  -> total 26,233, OVER by 19
 *
 * 20,000 already overruns the budget outright once a realistic diff is
 * counted rather than a short one, and the margin shrinks fast enough
 * above that (18,000 chars left only 565 tokens, about 2%) that "under"
 * and "comfortably under" are different numbers here. 16,000 is the
 * largest round one with real headroom: about 1,166 tokens, 4-5% of the
 * budget, to absorb the parts of a real change -- a longer commit message,
 * a diff with a heavier quote-and-brace mix than this repository's own --
 * that this measurement did not carry.
 */
export const MAX_INSTRUCTION_CHARS = 16_000;

/**
 * A pointer line runs to at most this many characters.
 *
 * A symlinked `CLAUDE.md` reads back as its target path -- `AGENTS.md`, or
 * `../AGENTS.md` with a directory in front of it -- and a line written by
 * hand doing the same job is usually "See AGENTS.md" or close to it: both
 * are a handful of characters. What this bound has to exclude is a
 * one-line document long enough to carry an instruction of its own --
 * "Everything in AGENTS.md applies, plus: never commit generated files."
 * is 68 characters and is a real rule, not a pointer. 48 sits between a
 * generous pointer and the shortest plausible one-line rule.
 */
export const POINTER_LINE_MAX = 48;

function show(ref: string | null, file: string, cwd: string): string | null {
  try {
    return execFileSync("git", ["show", `${ref ?? ""}:${file}`], {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // Every way `git show` can fail lands here alike: the file absent from
    // the tree, `cwd` not a repository, but also a partial clone still
    // missing this blob, a permissions error, a corrupt object. None of
    // those are distinguished from "no document", which means a real
    // failure here is invisible downstream -- the run reports no
    // instructions, a change rule produces no subject, and the run reads
    // as clean for a repository that HAS an AGENTS.md and was never
    // actually looked at. Anyone chasing that should start by running the
    // `git show` command above by hand, not by reading a stack trace,
    // because there isn't one.
    return null;
  }
}

/**
 * A duplicate copy: byte-identical, trimmed, to a document already kept.
 *
 * A hand-copied `CLAUDE.md` (`cp AGENTS.md CLAUDE.md` where a symlink
 * would have done the job) reads back this way -- the same rules, said
 * twice, costing tokens for nothing a model doesn't already have. Checked
 * only against documents already kept, in `INSTRUCTION_FILES` order, so of
 * two identical documents the first, `AGENTS.md`, is the one that stays.
 */
function isCopy(text: string, already: InstructionDoc[]): boolean {
  const body = text.trim();
  return already.some((d) => d.text.trim() === body);
}

/**
 * A document that is nothing but a reference to another one.
 *
 * `CLAUDE.md` is very often a symlink to `AGENTS.md` -- git stores that as
 * mode 120000 whose blob content is the target path, so it reads back as
 * the single line `AGENTS.md`, not as a copy of AGENTS.md's text -- or a
 * line someone wrote by hand saying to go read the other file. Either way
 * it says nothing twice.
 *
 * Checked by name against every entry in `INSTRUCTION_FILES`, not against
 * documents already read: a repository that had `CLAUDE.md` first and
 * symlinked `AGENTS.md` at it for portability points the other way from
 * the usual case, and the first document read has nothing behind it yet to
 * compare against -- a check that only looked backwards would let that
 * direction's target-path blob through as if it were a real document.
 *
 * `POINTER_LINE_MAX` is what keeps a genuine one-line rule from being read
 * as a pointer just because it happens to name the other file.
 */
function isPointer(file: string, text: string): boolean {
  const lines = text
    .trim()
    .split("\n")
    .filter((l) => l.trim() !== "");
  if (lines.length !== 1) return false;
  const line = lines[0]!;
  return line.length <= POINTER_LINE_MAX && INSTRUCTION_FILES.some((other) => other !== file && line.includes(other));
}

/**
 * Cut to `limit` characters at the last line boundary within that window,
 * so a rule normally sees whole lines rather than a sentence split in two.
 *
 * That only holds when the window has a boundary to cut at. A document
 * that opens with one line at least `limit` characters long has none --
 * `lastIndexOf("\n")` finds nothing (`-1`) or only the newline `head`
 * itself started with (`0`, which would throw away the entire window to
 * return one `"\n"`) -- and there the honest options are the raw head or
 * nothing at all. The raw head is returned, because a document truncated
 * mid-line is still evidence and a document dropped for being one long
 * paragraph is none.
 */
function cut(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const at = head.lastIndexOf("\n");
  return at > 0 ? head.slice(0, at + 1) : head;
}

/**
 * The documents in the tree `ref` names, or in the index when `ref` is
 * null.
 *
 * Order is `INSTRUCTION_FILES`, so `AGENTS.md` is the one kept whole when
 * `budget` bites. `budget` mirrors `commitDiff`'s and `rangeDiff`'s own
 * parameter in `src/commits.ts` -- same module pair, same concern -- and
 * defaults to `MAX_INSTRUCTION_CHARS`.
 */
export function readInstructions(ref: string | null, cwd: string = process.cwd(), budget: number = MAX_INSTRUCTION_CHARS): Instructions {
  const docs: InstructionDoc[] = [];
  let left = budget;
  let truncated = false;
  for (const file of INSTRUCTION_FILES) {
    const text = show(ref, file, cwd);
    // Absent from the tree, or nothing but whitespace in it: an empty
    // document is not a standard anything is judged against, so it is
    // treated the same as no document at all rather than as a duplicate.
    if (text === null || text.trim() === "") continue;
    if (isPointer(file, text) || isCopy(text, docs)) continue;
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
