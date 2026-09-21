/**
 * What a run looks at: the files, narrowed to a diff for `review`, or the
 * commit range for `commits`. Null after saying why when there is nothing
 * to look at or the range is unusable; `exit` says which code.
 */
import { defaultRange } from "../commits.ts";
import { changedFiles, changedFilesUnder, changedRanges, type ChangedRanges } from "../diff.ts";
import type { Rule } from "../types.ts";
import type { Log, Options } from "./args.ts";

export interface Targets {
  paths: string[];
  diffRanges: ChangedRanges | null;
  commitsRange: string | null;
}

export async function resolveTargets(
  command: string,
  rules: Rule[],
  opts: Options,
  rangeArg: string | undefined,
  out: Log,
  log: Log,
): Promise<Targets | { exit: number }> {
  // Which files to look at.
  let paths = opts.paths;
  let diffRanges: ChangedRanges | null = null;
  let commitsRange: string | null = null;
  if (command === "review") {
    diffRanges = await changedRanges({ base: opts.base, staged: opts.staged });
    // Scan only the changed files: matching the whole tree and discarding
    // everything outside the diff would cost the same as `check`. Paths given
    // on the command line or in the config narrow WHICH changed files, they
    // do not widen the scan back to the tree.
    const files = changedFilesUnder(changedFiles(diffRanges), paths);
    if (files.length === 0 && opts.format !== "json") {
      if (!opts.quiet) out("no changed files");
      return { exit: 0 };
    }
    // Under --json an empty run is still one document of the usual shape,
    // with nothing in it, rather than a line of prose where JSON was asked for.
    paths = files;
  } else if (command === "commits") {
    // `--staged` first: it names no range, since it judges the index, not
    // a commit -- and it is a different question from every other case
    // below, which all revolve around choosing a range.
    if (opts.staged) {
      // The index has no message yet, so only a change rule has anything
      // to ask about it -- a commit rule's question does not exist there.
      if (!rules.some((r) => r.subject === "change")) {
        log("commits --staged: no `subject: change` rule is loaded; the shipped one is rules/git/diff-follows-instructions");
        return { exit: 2 };
      }
      if (opts.squash) {
        log("commits: --staged and --squash are different questions; pass one");
        return { exit: 2 };
      }
      return { paths: [], diffRanges: null, commitsRange: "staged" };
    }
    // The range is a positional (`main..HEAD`), else `--base <ref>`, else
    // what is not yet pushed. A repository with no upstream and no `--base`
    // has no default worth guessing at.
    const range = rangeArg ?? (opts.base ? `${opts.base}..HEAD` : defaultRange());
    if (!range) {
      log("commits: no range. Give one (`main..HEAD`), or --base <ref>, or set an upstream");
      return { exit: 2 };
    }
    if (!rules.some((r) => r.subject === "commit" || r.subject === "change")) {
      log(
        "commits: no `subject: commit` or `subject: change` rule is loaded; the shipped ones are rules/git/commit-message-describes-diff and rules/git/diff-follows-instructions",
      );
      return { exit: 2 };
    }
    if (opts.squash && opts.message === null) {
      log("commits --squash needs the message to judge the range against: --message <text> or --message-file <path|->");
      return { exit: 2 };
    }
    if (!opts.squash && opts.message !== null) {
      log("commits: --message is for --squash; each commit has its own message");
      return { exit: 2 };
    }
    commitsRange = range;
    paths = [];
  } else if (paths.length === 0) {
    paths = ["."];
  }

  return { paths, diffRanges, commitsRange };
}
