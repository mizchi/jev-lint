/**
 * Review mode: restricting a run to what a change touched.
 *
 * The full-tree mode answers "what is wrong with this repository". Review mode
 * answers a different and much cheaper question -- "what did this change make
 * worse" -- and cheapness is what makes it usable in a pull request: a diff
 * touching four files costs four requests and a few hundredths of a cent,
 * which is a budget that fits inside CI without anybody negotiating for it.
 *
 * Overlap is tested against the SUBJECT's range, not the matched node's. For a
 * `subject: node` rule those are the same thing. For `subject: enclosing` the
 * subject is the containing function, so editing one line inside a function
 * re-opens the judgments that are about that function as a whole -- which is
 * what you want from a reviewer, and what a match-range test would miss.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Post-image line ranges per file, inclusive at both ends. */
export type ChangedRanges = Map<string, Array<[number, number]>>;

/** Parse the `@@ -a,b +c,d @@` headers of a unified diff with zero context. */
export function parseUnifiedDiff(text: string): ChangedRanges {
  const byFile: ChangedRanges = new Map();
  let file: string | null = null;
  for (const line of text.split("\n")) {
    // `+++ b/path` gives the post-image path, which is the one whose line
    // numbers the hunk headers refer to.
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      file = path === "/dev/null" ? null : path.replace(/^b\//, "");
      if (file && !byFile.has(file)) byFile.set(file, []);
      continue;
    }
    if (!file || !line.startsWith("@@")) continue;
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    // A hunk with a zero line count is a pure deletion: nothing in the
    // post-image changed, so there is nothing here to review.
    if (count === 0) continue;
    byFile.get(file)!.push([start, start + count - 1]);
  }
  for (const [k, ranges] of byFile) {
    if (ranges.length === 0) byFile.delete(k);
    else byFile.set(k, merge(ranges));
  }
  return byFile;
}

function merge(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [sorted[0]!];
  for (const [s, e] of sorted.slice(1)) {
    const last = out.at(-1)!;
    if (s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

/**
 * Changed line ranges per file.
 *
 * With `base`, compares against the merge base (`base...HEAD`), which is what
 * a pull request shows: commits that landed on the base branch meanwhile are
 * not this change's doing. Without it, compares the working tree against HEAD,
 * so uncommitted edits are reviewable before they are committed.
 */
export async function changedRanges({
  base = null,
  cwd = process.cwd(),
  staged = false,
}: { base?: string | null; cwd?: string; staged?: boolean } = {}): Promise<ChangedRanges> {
  const args = ["diff", "--unified=0", "--no-color", "--no-ext-diff", "--diff-filter=d"];
  if (staged) args.push("--cached");
  if (base) args.push(`${base}...HEAD`);
  else if (!staged) args.push("HEAD");
  const text = await git(args, cwd);
  const ranges = parseUnifiedDiff(text);

  // Untracked files never appear in `git diff`, and "new file nobody has added
  // yet" is a normal state to want reviewed. They count as changed in full.
  if (!base) {
    let untracked = "";
    try {
      untracked = await git(["ls-files", "--others", "--exclude-standard"], cwd);
    } catch {
      untracked = "";
    }
    for (const f of untracked.split("\n").map((s) => s.trim()).filter(Boolean)) {
      if (!ranges.has(f)) ranges.set(f, [[1, Number.MAX_SAFE_INTEGER]]);
    }
  }
  return ranges;
}

/** Does `[line, endLine]` intersect any changed range for this file? */
export function touchesChange(
  ranges: ChangedRanges,
  file: string,
  line: number,
  endLine: number,
): boolean {
  const list = ranges.get(file);
  if (!list) return false;
  return list.some(([s, e]) => line <= e && endLine >= s);
}

/**
 * Resolve the paths a review should scan.
 *
 * Returning the changed files rather than the whole tree is not only a speed
 * matter: ast-grep would otherwise match the entire repository and every match
 * outside the diff would have to be discarded after the fact.
 */
export function changedFiles(
  ranges: ChangedRanges,
  { filter = null }: { filter?: ((f: string) => boolean) | null } = {},
): string[] {
  const files = [...ranges.keys()];
  return filter ? files.filter(filter) : files;
}
