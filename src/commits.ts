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
import { readInstructions, type Instructions } from "./instructions.ts";
import { isGitSubject } from "./types.ts";
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
  /**
   * Non-merge commits a change rule was loaded for but could not be asked
   * about: their tree held neither `AGENTS.md` nor `CLAUDE.md`, so there was
   * no standard to judge the diff against. Always 0 when no change rule was
   * loaded, or from `squashSubjects`, which builds no change subjects at all.
   */
  noInstructionDoc: number;
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
  // Cut at the last hunk or file boundary under the budget, so the model
  // never sees half a hunk and reads the missing half as unchanged -- shared
  // with `rangeDiff` and `stagedDiff` as `cutDiff`, below.
  return cutDiff(sha, files, stat, full, budget);
}

/**
 * One subject per non-merge commit per commit rule, and one per non-merge
 * commit per change rule whose tree has a non-empty diff and an
 * instruction document.
 *
 * A commit rule's message is the subject text, so identical messages over
 * identical diffs share a verdict; the diff rides along as `commit` for the
 * state. A change rule's subject text is the stat instead (see
 * `changeSubject`). `file` is the sha and `line` is 1 for both, which is
 * what a finding reports.
 */
export function commitSubjects(
  rules: Rule[],
  range: string,
  cwd: string = process.cwd(),
  /** What a finding calls the commit: the sha unless a suite names it by its patch file. */
  label: (sha: string) => string = (sha) => sha,
): CommitSubjects {
  const commitRules = rules.filter((r) => r.subject === "commit");
  const changeRules = rules.filter((r) => r.subject === "change");
  const commits = listCommits(range, cwd);
  const subjects: Subject[] = [];
  let skippedMerges = 0;
  let noInstructionDoc = 0;
  for (const c of commits) {
    if (c.parents.length > 1) {
      skippedMerges += 1;
      continue;
    }
    if (commitRules.length === 0 && changeRules.length === 0) continue;
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
    // A change subject needs two things a commit rule does not: a standard
    // to judge the diff against, and a diff to judge. An empty commit
    // (`--allow-empty` -- a CI trigger, a rebase-retained marker) has stat
    // `""` and nothing else either, so it is skipped here before
    // `readInstructions` even runs, saving that `git show` for the commit
    // that could never have produced a subject. This is not symmetrical
    // with a commit rule: "this message claims X over an empty diff" is a
    // real finding, so an empty commit still gets a commit subject above --
    // only the change subject, which has no message to fall back on, has
    // nothing left to be about.
    //
    // With no instruction document in the tree there is likewise no
    // standard, and no subject -- a question with nothing behind it is not
    // a clean verdict. Counted rather than silently dropped: a run report
    // has to be able to say *why* a change rule asked about nothing, rather
    // than call it a matcher that missed (it has none).
    if (changeRules.length > 0 && diff.stat.trim() !== "") {
      const instructions = readInstructions(c.sha, cwd);
      if (instructions.docs.length === 0) {
        noInstructionDoc += 1;
      } else {
        for (const rule of changeRules) {
          subjects.push(changeSubject(rule, label(c.sha), diff, instructions));
        }
      }
    }
  }
  return { subjects, commits: commits.length, skippedMerges, noInstructionDoc };
}

/**
 * One change subject: the stat is the subject, the diff and the
 * instructions are the state.
 *
 * The subject text is the stat rather than the message, because a change
 * rule is not about the message and there may not be one -- `--staged`
 * runs before a message exists. `SUBJECT` is the stat's summary line, which
 * is what a rule refers to when it needs the size of the change.
 *
 * `readInstructions` looks up `AGENTS.md`, then `CLAUDE.md` only when the
 * first document is missing or unusable. The change subject reads these
 * from the same tree as the diff. A memo keyed on the sha cannot help here:
 * each sha is read once in the range.
 */
function changeSubject(rule: Rule, file: string, diff: CommitDiff, instructions: Instructions): Subject {
  const summary = diff.stat.trim().split("\n").pop() ?? "";
  return {
    rule,
    file,
    language: "Git",
    arm: "bare",
    text: diff.stat,
    line: 1,
    endLine: 1,
    nodeKind: "change",
    enclosing: null,
    promoted: false,
    captured: { SUBJECT: summary.trim() },
    commit: diff,
    instructions,
  };
}

/**
 * A whole range as one change, judged against a message of its own: a pull
 * request's description, a changelog entry. `A..B` and `A...B` are given to
 * `git diff` as they are (the second is from the merge base); a bare ref is
 * that ref to HEAD. The subject is named by the range, since no one commit
 * is the subject.
 */
export function squashSubjects(rules: Rule[], range: string, message: string, cwd: string = process.cwd()): CommitSubjects {
  // `commit` only, deliberately: a squash is a range judged against a
  // message someone wrote for it, which is a commit rule's question. A
  // change rule needs no message and is per-commit, not per-range, so it
  // has nothing to say here -- one change subject per commit that has an
  // instruction document belongs to `commitSubjects` instead. (The CLI does
  // not yet accept a rule set with no commit rule for `commits <range>`
  // either; that is a separate gap in `src/cli/targets.ts`, not this one.)
  const commitRules = rules.filter((r) => r.subject === "commit");
  const spec = range.includes("..") ? range : `${range}..HEAD`;
  const commits = listCommits(spec, cwd).filter((c) => c.parents.length <= 1);
  if (commitRules.length === 0 || commits.length === 0) return { subjects: [], commits: commits.length, skippedMerges: 0, noInstructionDoc: 0 };
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
  return { subjects, commits: commits.length, skippedMerges: 0, noInstructionDoc: 0 };
}

/**
 * What is staged, as one change.
 *
 * The pre-commit hook's subject: there is no commit and no message yet, so
 * only `subject: change` rules produce anything -- a commit rule asks about
 * a message that does not exist. `stagedDiff` is `git diff --cached` for
 * the change and `readInstructions(null, cwd)` is `git show :<file>` for
 * the instructions, both from the index, so a staged edit to `AGENTS.md`
 * is judged as part of the change it arrives with rather than leaving the
 * old document to judge the new code.
 *
 * Nothing staged is no subjects, not one subject over an empty change: a
 * commit that exists always gets judged, even an empty one (see
 * `commitSubjects`), but there is no commit here to be empty. No
 * instruction document is likewise no subjects, counted in
 * `noInstructionDoc` for the same reason `commitSubjects` counts it --
 * consistent with it rather than a second, differently-shaped answer to
 * the same question.
 */
export function stagedSubjects(rules: Rule[], cwd: string = process.cwd()): CommitSubjects {
  const changeRules = rules.filter((r) => r.subject === "change");
  if (changeRules.length === 0) return { subjects: [], commits: 0, skippedMerges: 0, noInstructionDoc: 0 };
  const diff = stagedDiff(cwd);
  if (diff.stat.trim() === "") return { subjects: [], commits: 0, skippedMerges: 0, noInstructionDoc: 0 };
  const instructions = readInstructions(null, cwd);
  if (instructions.docs.length === 0) return { subjects: [], commits: 1, skippedMerges: 0, noInstructionDoc: 1 };
  return {
    subjects: changeRules.map((rule) => changeSubject(rule, "staged", diff, instructions)),
    commits: 1,
    skippedMerges: 0,
    noInstructionDoc: 0,
  };
}

/**
 * The tail `commitDiff`, `rangeDiff` and `stagedDiff` all share once each
 * has its own `files`, `stat` and `full` diff: cut the patch at the last
 * hunk or file boundary under budget, so the model never sees half a hunk.
 * What differs between the three is only the git incantation that produces
 * those three strings -- `git show <sha>`, `git diff <spec>`, `git diff
 * --cached` -- not what happens to them afterward.
 */
function cutDiff(sha: string, files: string[], stat: string, full: string, budget: number): CommitDiff {
  if (full.length <= budget) return { sha, files, stat, diff: full.trimEnd(), truncated: false };
  const head = full.slice(0, budget);
  const at = Math.max(head.lastIndexOf("\ndiff --git "), head.lastIndexOf("\n@@ "));
  return { sha, files, stat, diff: (at > 0 ? head.slice(0, at) : head).trimEnd(), truncated: true };
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
  return cutDiff(spec, files, stat, full, budget);
}

/**
 * `commitDiff` for the index: the same caps, from `git diff --cached` in
 * place of `git show <sha>`, and `sha: "staged"` since there is no commit
 * yet for a finding to name.
 */
function stagedDiff(cwd: string, budget: number = MAX_DIFF_CHARS): CommitDiff {
  const allFiles = git(["diff", "--cached", "--name-only", "--no-ext-diff", "--no-color"], cwd)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const files =
    allFiles.length > MAX_FILES ? [...allFiles.slice(0, MAX_FILES), `… and ${allFiles.length - MAX_FILES} more files`] : allFiles;
  const statLines = git(["diff", "--cached", "--stat=100", "--no-ext-diff", "--no-color"], cwd).trim().split("\n");
  const stat =
    statLines.length > MAX_STAT_LINES
      ? [...statLines.slice(0, MAX_STAT_LINES - 1), `… ${statLines.length - MAX_STAT_LINES} more files not listed`, statLines[statLines.length - 1]!].join("\n")
      : statLines.join("\n");
  const full = git(["diff", "--cached", "--no-ext-diff", "--no-color"], cwd);
  return cutDiff("staged", files, stat, full, budget);
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

/**
 * The subjects a commit suite's fixtures produce, named by their case
 * directories.
 *
 * `patchRepo` selects a case by the presence of a `message` file, which a
 * change rule never reads -- it judges the diff, not a message. A change
 * fixture written without one (nothing yet forces this; see the `message`
 * requirement in `patchRepo`) is silently absent from `cases` rather than
 * an error: fewer cases scored than there are directories, with nothing
 * that says why.
 */
export function commitFixtureSubjects(rules: Rule[], fixtures: string): Subject[] {
  if (!rules.some((r) => isGitSubject(r.subject))) return [];
  const repo = patchRepo(fixtures);
  return commitSubjects(rules, repo.range, repo.cwd, repo.label).subjects;
}
