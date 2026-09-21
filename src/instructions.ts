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
 * still enough to carry AGENTS.md and CLAUDE.md whole for a repository of
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
 * A document that IS a symlink, read back as its target.
 *
 * `CLAUDE.md` is very often a symlink to `AGENTS.md`, at any depth
 * (`docs/AGENTS.md`, `.github/AGENTS.md`, `../AGENTS.md`) and in either
 * direction. Git stores a symlink as mode 120000 whose blob content is
 * nothing but the target path -- no newline, no surrounding prose, no
 * whitespace at all, because a path can't contain any. That is the whole
 * signal: a document that is a single line, that line has no whitespace in
 * it, and it either equals one of `INSTRUCTION_FILES` or ends with `/`
 * followed by one. No real instruction document is a single bare path, so
 * this cannot mistake one for a symlink.
 *
 * It also cannot mistake a symlink for anything longer: this does not try
 * to catch a written pointer like "See AGENTS.md for all conventions" --
 * that survives as a document, and costs a few tokens for a sentence that
 * tells a model nothing false. Checked by name against every entry in
 * `INSTRUCTION_FILES`, including the document's own name: a symlink can
 * point either way (a repository that had `CLAUDE.md` first and later
 * symlinked `AGENTS.md` at it, for portability, points opposite the usual
 * case), and checking only the other name would miss exactly that
 * direction the same way comparing only against documents already read
 * did before this.
 *
 * Two documents that symlink at each other -- `AGENTS.md` -> `CLAUDE.md`
 * and back -- both get dropped here, leaving `docs: []`, indistinguishable
 * from a repository with neither file. That's fine: a symlink loop has
 * nothing to read either way.
 *
 * What is NOT fine, and is the cost of this being a drop rather than a
 * resolve: a repository that keeps the real document at `docs/AGENTS.md`
 * and symlinks the root at it gets `docs: []`, so no subject and no
 * judging at all. The link is recognised and then nothing follows it,
 * because the target is outside the root-only scope. Dropping beats the
 * alternative that shipped before -- the literal string `docs/AGENTS.md`
 * handed to a model as a standard -- but it is silence where a reader
 * would expect their instructions to be read. Following one hop is a
 * `git show <ref>:<target>` away if that layout turns out to be common.
 */
function isPointer(text: string): boolean {
  const lines = text
    .trim()
    .split("\n")
    .filter((l) => l.trim() !== "");
  if (lines.length !== 1) return false;
  const line = lines[0]!.trim();
  if (/\s/.test(line)) return false;
  return INSTRUCTION_FILES.some((name) => line === name || line.endsWith(`/${name}`));
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
 * Below this many characters of budget left, a document is skipped rather
 * than cut down to a scrap.
 *
 * `cut`'s no-boundary fallback is the right call for one long paragraph
 * and the wrong one for whatever is left after an earlier document has
 * already taken most of the budget: a remainder of a handful of characters
 * produces a fragment of a word, which tells a model nothing an absent
 * document doesn't, while still costing the tokens of a second entry in
 * `docs` and the "here is a standard" framing around it. 40 is roughly the
 * shortest a real, terse instruction reads -- "Write commits in
 * English." is 25 characters, "Never commit secrets." is 21 -- so a
 * remainder under that is treated as exhausted rather than as something to
 * cut.
 */
const MIN_INSTRUCTION_REMAINDER = 40;

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
    if (isPointer(text) || isCopy(text, docs)) continue;
    if (left < MIN_INSTRUCTION_REMAINDER) {
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
