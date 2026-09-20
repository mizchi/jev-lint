/**
 * Commits as subjects.
 *
 * A commit message is a claim and its diff is the body, which is the class
 * of defect this tool exists for: "Fix the retry loop" over a diff that
 * adds a feature, "no behaviour change" over a diff that changes a default.
 * Nothing here is an AST node, so nothing here goes through ast-grep: the
 * subjects are built from `git log` and `git show`, and from there on they
 * travel the same road as every other subject -- a batch, a state, a
 * question, a verdict, a finding.
 *
 * One commit is one batch. The state carries the message and the diff, the
 * question carries the message again as the thing under judgment, and the
 * finding reports `<sha>:1`. The diff is capped to what a state can hold;
 * over that, the stat stays whole and the patch is cut, and the state says
 * so, because a model told it is reading "the diff" would read a cut as a
 * change that was not made.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Rule, Subject } from "./types.ts";

export interface Commit {
  sha: string;
  parents: string[];
  /** The first line of the message. */
  subject: string;
  /** The whole message, subject and body, trailing whitespace trimmed. */
  message: string;
}

export interface CommitDiff {
  sha: string;
  /** The paths the commit touches, from `--name-only`, at most `MAX_FILES` then a count. */
  files: string[];
  /** `--stat`, cut to `MAX_STAT_LINES` with its summary line kept. */
  stat: string;
  /** The unified diff, cut to `MAX_DIFF_CHARS` at a hunk boundary. */
  diff: string;
  truncated: boolean;
}

/**
 * Characters of patch per commit: about 14k tokens at the measured ratio
 * for source. The stat and the file list are capped beside it, because a
 * 350-file commit's stat alone is 25k characters; together the three stay
 * under the 32Ki state budget with room for the message and the question.
 */
export const MAX_DIFF_CHARS = 48_000;
export const MAX_STAT_LINES = 120;
export const MAX_FILES = 200;

/** Merges are skipped: their diff is their parents', already judged. */
export interface CommitSubjects {
  subjects: Subject[];
  commits: number;
  skippedMerges: number;
}

// `--no-ext-diff` on every diff-producing call: a user's `diff.external`
// (difftastic, delta) would otherwise replace the unified diff the model is
// asked to read with a rendering the model was never shown in calibration.
function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * The commits in a range, oldest first -- the order a reviewer reads them
 * in. `range` is anything `git log` takes: `main..HEAD`, `@{upstream}..HEAD`,
 * a single ref for everything reachable from it.
 */
export function listCommits(range: string, cwd: string = process.cwd()): Commit[] {
  // The range is passed as git arguments, split on whitespace, so a suite
  // can say `--no-walk <sha> <sha>` and a user can say `main..HEAD`.
  const out = git(["log", "--reverse", "--format=%H%x00%P%x00%B%x1e", ...range.split(/\s+/).filter((a) => a !== "")], cwd);
  const commits: Commit[] = [];
  for (const record of out.split("\x1e")) {
    if (record.trim() === "") continue;
    const [sha, parents, body] = record.replace(/^\n/, "").split("\x00");
    if (!sha || body === undefined) continue;
    const message = body.replace(/\s+$/, "");
    commits.push({
      sha: sha.trim(),
      parents: (parents ?? "").trim().split(/\s+/).filter((p) => p !== ""),
      subject: message.split("\n")[0] ?? "",
      message,
    });
  }
  return commits;
}

/** The change one commit made, cut to what a state can carry. */
export function commitDiff(sha: string, cwd: string = process.cwd(), budget: number = MAX_DIFF_CHARS): CommitDiff {
  const allFiles = git(["show", "--format=", "--name-only", "--no-ext-diff", "--no-color", sha], cwd)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const files =
    allFiles.length > MAX_FILES
      ? [...allFiles.slice(0, MAX_FILES), `… and ${allFiles.length - MAX_FILES} more files`]
      : allFiles;
  const statLines = git(["show", "--format=", "--stat=100", "--no-ext-diff", "--no-color", sha], cwd).trim().split("\n");
  // The summary line at the end of a stat is the one that must survive a cut.
  const stat =
    statLines.length > MAX_STAT_LINES
      ? [...statLines.slice(0, MAX_STAT_LINES - 1), `… ${statLines.length - MAX_STAT_LINES} more files not listed`, statLines[statLines.length - 1]!].join("\n")
      : statLines.join("\n");
  const full = git(["show", "--format=", "--no-ext-diff", "--no-color", sha], cwd);
  if (full.length <= budget) return { sha, files, stat, diff: full.trimEnd(), truncated: false };
  // Cut at the last hunk or file boundary under the budget, so the model
  // never sees half a hunk and reads the missing half as unchanged.
  const head = full.slice(0, budget);
  const at = Math.max(head.lastIndexOf("\ndiff --git "), head.lastIndexOf("\n@@ "));
  const diff = (at > 0 ? head.slice(0, at) : head).trimEnd();
  return { sha, files, stat, diff, truncated: true };
}

/**
 * One subject per non-merge commit per commit rule.
 *
 * The message is the subject text, so identical messages over identical
 * diffs share a verdict; the diff rides along as `commit` for the state.
 * `file` is the sha and `line` is 1, which is what a finding reports.
 */
export function commitSubjects(
  rules: Rule[],
  range: string,
  cwd: string = process.cwd(),
  /** What a finding calls the commit: the sha unless a suite names it by its patch file. */
  label: (sha: string) => string = (sha) => sha,
): CommitSubjects {
  const commitRules = rules.filter((r) => r.subject === "commit");
  const commits = listCommits(range, cwd);
  const subjects: Subject[] = [];
  let skippedMerges = 0;
  for (const c of commits) {
    if (c.parents.length > 1) {
      skippedMerges += 1;
      continue;
    }
    if (commitRules.length === 0) continue;
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
  }
  return { subjects, commits: commits.length, skippedMerges };
}

/**
 * A whole range as one change, judged against a message of its own: a pull
 * request's description, a changelog entry. `A..B` and `A...B` are given to
 * `git diff` as they are (the second is from the merge base); a bare ref is
 * that ref to HEAD. The subject is named by the range, since no one commit
 * is the subject.
 */
export function squashSubjects(rules: Rule[], range: string, message: string, cwd: string = process.cwd()): CommitSubjects {
  const commitRules = rules.filter((r) => r.subject === "commit");
  const spec = range.includes("..") ? range : `${range}..HEAD`;
  const commits = listCommits(spec, cwd).filter((c) => c.parents.length <= 1);
  if (commitRules.length === 0 || commits.length === 0) return { subjects: [], commits: commits.length, skippedMerges: 0 };
  const diff = rangeDiff(spec, cwd);
  const text = message.replace(/\s+$/, "");
  const subjects: Subject[] = commitRules.map((rule) => ({
    rule,
    file: spec,
    language: "Git",
    arm: "bare",
    text,
    line: 1,
    endLine: 1,
    nodeKind: "commit",
    enclosing: null,
    promoted: false,
    captured: { SUBJECT: text.split("\n")[0] ?? "" },
    commit: diff,
  }));
  return { subjects, commits: commits.length, skippedMerges: 0 };
}

/** `commitDiff` for a range: the same caps, from `git diff` instead of `git show`. */
function rangeDiff(spec: string, cwd: string, budget: number = MAX_DIFF_CHARS): CommitDiff {
  const allFiles = git(["diff", "--name-only", "--no-ext-diff", "--no-color", spec], cwd)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const files =
    allFiles.length > MAX_FILES ? [...allFiles.slice(0, MAX_FILES), `… and ${allFiles.length - MAX_FILES} more files`] : allFiles;
  const statLines = git(["diff", "--stat=100", "--no-ext-diff", "--no-color", spec], cwd).trim().split("\n");
  const stat =
    statLines.length > MAX_STAT_LINES
      ? [...statLines.slice(0, MAX_STAT_LINES - 1), `… ${statLines.length - MAX_STAT_LINES} more files not listed`, statLines[statLines.length - 1]!].join("\n")
      : statLines.join("\n");
  const full = git(["diff", "--no-ext-diff", "--no-color", spec], cwd);
  if (full.length <= budget) return { sha: spec, files, stat, diff: full.trimEnd(), truncated: false };
  const head = full.slice(0, budget);
  const at = Math.max(head.lastIndexOf("\ndiff --git "), head.lastIndexOf("\n@@ "));
  return { sha: spec, files, stat, diff: (at > 0 ? head.slice(0, at) : head).trimEnd(), truncated: true };
}

/** Is this the range git means when nothing was given: what is not yet pushed? */
export function defaultRange(cwd: string = process.cwd()): string | null {
  try {
    git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd);
    return "@{upstream}..HEAD";
  } catch {
    return null;
  }
}

/**
 * A suite's fixtures as commits: every `fixtures/<case>/` holds a
 * `message`, a `before/` tree and an `after/` tree, and becomes one commit
 * -- `after` over `before`, with that message -- on its own orphan branch
 * of a throwaway repository, so the cases are independent of one another
 * and need no knowledge of git to write. `label` maps each resulting sha
 * back to its case directory, which is what `expect.yml` keys its
 * expectations on (at line 1).
 */
export function patchRepo(fixtures: string): { cwd: string; label: (sha: string) => string; cases: string[]; range: string } {
  const cases = readdirSync(fixtures, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(fixtures, e.name, "message")))
    .map((e) => e.name)
    .sort();
  const cwd = mkdtempSync(join(tmpdir(), "jev-lint-commits-"));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "jev-lint",
    GIT_AUTHOR_EMAIL: "eval@jev-lint",
    GIT_COMMITTER_NAME: "jev-lint",
    GIT_COMMITTER_EMAIL: "eval@jev-lint",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  };
  const run = (args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  run(["init", "-q", "-b", "main"]);
  run(["config", "commit.gpgsign", "false"]);
  const byShaPath = new Map<string, string>();
  const tips: string[] = [];
  const clear = () => {
    for (const e of readdirSync(cwd)) if (e !== ".git") rmSync(join(cwd, e), { recursive: true, force: true });
  };
  for (const name of cases) {
    // Absolute: git runs in the throwaway repository, not where the suite is.
    const dir = resolve(fixtures, name);
    run(["checkout", "-q", "--orphan", `case/${name}`]);
    clear();
    if (existsSync(join(dir, "before"))) cpSync(join(dir, "before"), cwd, { recursive: true });
    run(["add", "-A"]);
    run(["commit", "-q", "--allow-empty", "-m", `base for ${name}`]);
    clear();
    if (existsSync(join(dir, "after"))) cpSync(join(dir, "after"), cwd, { recursive: true });
    run(["add", "-A"]);
    run(["commit", "-q", "--allow-empty", "-F", join(dir, "message")]);
    const sha = run(["rev-parse", "HEAD"]);
    byShaPath.set(sha, join(fixtures, name));
    tips.push(sha);
  }
  // The range: every case's tip and nothing else -- not the base commits.
  const range = tips.length > 0 ? `--no-walk ${tips.join(" ")}` : "HEAD";
  return { cwd, label: (sha) => byShaPath.get(sha) ?? sha, cases, range };
}

/** The subjects a commit suite's fixtures produce, named by their case directories. */
export function commitFixtureSubjects(rules: Rule[], fixtures: string): Subject[] {
  if (!rules.some((r) => r.subject === "commit")) return [];
  const repo = patchRepo(fixtures);
  return commitSubjects(rules, repo.range, repo.cwd, repo.label).subjects;
}
