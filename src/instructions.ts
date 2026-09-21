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
