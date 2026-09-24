/**
 * The instructions a repository wrote for itself, as evidence.
 *
 * `AGENTS.md` (or `CLAUDE.md` when absent) says what a change is supposed
 * to do. Read here from the same tree as the diff it will
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
import type { Instructions, InstructionDoc } from "./types.ts";
import { posix } from "node:path";

// The two shapes a subject carries live in the contract layer, not here:
// `src/types.ts` defines what a subject is, and a subject holds these. They
// are re-exported so a reader who found this module first does not have to
// know that.
export type { Instructions, InstructionDoc } from "./types.ts";

/**
 * Repository root only, for DISCOVERY: these are the only paths looked for
 * without being told where to look. A root-level file that is a symlink is
 * different -- the repository is saying where its real document lives,
 * and that target IS followed (see `resolvePointer`) -- but nothing here
 * goes hunting for a nested `docs/AGENTS.md` on its own initiative.
 */
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
 * The rest of a change's state -- message, diff, stat, files -- is NOT a
 * fixed cost to measure this against. `MAX_DIFF_CHARS` bounds the diff by
 * characters, but `MAX_FILES` and `MAX_STAT_LINES` bound `files` and
 * `stat` by COUNT, not by the length of each entry, and the commit message
 * has no bound at all. Measured with this repository's own
 * `estimateTokens`, holding the diff fixed at real source from this repo
 * (so the quote-and-brace density is this codebase's own, not guessed) and
 * varying only path length, stat column width and message length across a
 * plausible range: the baseline with no instructions runs from about
 * 20,800 tokens (short paths, a narrow stat, a one-line message) to about
 * 26,500 (deep monorepo paths, a wide stat, a long message) -- a swing of
 * roughly 5,700 tokens that has nothing to do with instructions at all. At
 * the high end, the baseline alone is already at `STATE_BUDGET` (26,214)
 * with zero characters of instructions added.
 *
 * So there is no fixture here where a margin is a stable property of a
 * chosen number; the honest claim is comparative. Instructions text costs
 * about 4,777 tokens at 16,000 characters, 5,962 at 20,000, 7,149 at the
 * old 24,000 -- fixed ratios, since the doc content's shape doesn't swing
 * the way the baseline does. Under every baseline measured here, 16,000
 * fits or comes far closer to fitting than 24,000 does, and there is no
 * baseline measured here where 24,000 fits. 16,000 is picked on that
 * comparison, not on a margin: a change subject is `arm: "bare"`, and a
 * one-subject batch has no step-down to recover with, so smaller is safer
 * here in a way it isn't for a file with many subjects -- and 16,000 is
 * still enough to carry an AGENTS.md whole for a repository of
 * ordinary size.
 */
export const MAX_INSTRUCTION_CHARS = 16_000;

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
    // failure here is invisible downstream -- a fallback CLAUDE.md may be
    // used, or the run may report no instructions and produce no change
    // subject despite a real AGENTS.md. Anyone chasing that should start by running the
    // `git show` command above by hand, not by reading a stack trace,
    // because there isn't one.
    return null;
  }
}

/**
 * The path a symlink-shaped document points at, or null if this document
 * isn't shaped like one.
 *
 * `CLAUDE.md` is very often a symlink to `AGENTS.md`, at any depth
 * (`docs/AGENTS.md`, `.github/AGENTS.md`) and in either direction. Git
 * stores a symlink as mode 120000 whose blob content is nothing but the
 * target path -- no newline, no surrounding prose, no whitespace at all,
 * because a path can't contain any. That is the whole signal: a document
 * that is a single line, that line has no whitespace in it, and it either
 * equals one of `INSTRUCTION_FILES` or ends with `/` followed by one. No
 * real instruction document is a single bare path, so this cannot mistake
 * one for a symlink, and it cannot mistake a symlink for anything longer
 * either: a written pointer like "See AGENTS.md for all conventions" has
 * whitespace in it and is never treated as one -- it survives as a
 * document, costing a few tokens for a sentence that tells a model nothing
 * false.
 *
 * Checked by name against every entry in `INSTRUCTION_FILES`, including
 * the document's own name: a symlink can point either way (a repository
 * that had `CLAUDE.md` first and later symlinked `AGENTS.md` at it, for
 * portability, points opposite the usual case), and checking only the
 * other name would miss exactly that direction.
 */
function pointerTarget(text: string): string | null {
  const lines = text
    .trim()
    .split("\n")
    .filter((l) => l.trim() !== "");
  if (lines.length !== 1) return null;
  const line = lines[0]!.trim();
  if (/\s/.test(line)) return null;
  return INSTRUCTION_FILES.some((name) => line === name || line.endsWith(`/${name}`)) ? line : null;
}

/**
 * Read a symlink-shaped document by following it to what it names, rather
 * than handing a model the target path as if that path were the document.
 * Returns null wherever following is not the right thing to do:
 *
 *  - the target leaves the repository root (`../`, or absolute): that is
 *    not this repository pointing at its own document, and `git show
 *    <ref>:<target>` would not be a repository-relative pathspec even if
 *    it happened to resolve to something outside the tree. The check is
 *    made here, where a reader can see it, rather than left to however
 *    git's error handling reacts to it.
 *  - the target is absent from this tree, or empty: a dangling symlink is
 *    the same as no document, not a document whose text is its own path.
 *  - the target is ITSELF symlink-shaped: one hop, then stop. Two
 *    documents that symlink at each other (`AGENTS.md` -> `CLAUDE.md` ->
 *    `AGENTS.md`) would recurse forever without this; instead both
 *    directions read as no document, the same as a repository with
 *    neither file.
 *
 * The returned document's `file` is the resolved target, not the link's
 * own name -- a finding reports where its text actually came from.
 */
function resolvePointer(ref: string | null, target: string, cwd: string): InstructionDoc | null {
  const path = posix.normalize(target);
  if (path === ".." || path.startsWith("../") || path.startsWith("/")) return null;
  const text = show(ref, path, cwd);
  if (text === null || text.trim() === "" || pointerTarget(text) !== null) return null;
  return { file: path, text };
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
 * Below this many characters of budget, a document is skipped rather than
 * cut down to a scrap.
 *
 * A budget of a handful of characters produces a fragment of a word,
 * which tells a model nothing an absent document doesn't. 40 is roughly the
 * shortest a real, terse instruction reads -- "Write commits in
 * English." is 25 characters, "Never commit secrets." is 21 -- so a
 * budget under that is treated as exhausted rather than as something to
 * cut.
 */
const MIN_INSTRUCTION_REMAINDER = 40;

/**
 * The instruction document in the tree `ref` names, or in the index when `ref` is
 * null.
 *
 * `AGENTS.md` takes precedence; `CLAUDE.md` is a fallback. `budget` mirrors
 * `commitDiff`'s and `rangeDiff`'s own
 * parameter in `src/commits.ts` -- same module pair, same concern -- and
 * defaults to `MAX_INSTRUCTION_CHARS`.
 */
export function readInstructions(ref: string | null, cwd: string = process.cwd(), budget: number = MAX_INSTRUCTION_CHARS): Instructions {
  for (const file of INSTRUCTION_FILES) {
    const text = show(ref, file, cwd);
    // Absent from the tree, or nothing but whitespace in it: an empty
    // document is not a standard anything is judged against, so it is
    // treated the same as no document at all.
    if (text === null || text.trim() === "") continue;
    const target = pointerTarget(text);
    const document = target !== null ? resolvePointer(ref, target, cwd) : { file, text };
    if (document === null) continue;
    if (budget < MIN_INSTRUCTION_REMAINDER) return { docs: [], truncated: true };
    const kept = cut(document.text, budget);
    return { docs: [{ file: document.file, text: kept }], truncated: kept.length < document.text.length };
  }
  return { docs: [], truncated: false };
}
