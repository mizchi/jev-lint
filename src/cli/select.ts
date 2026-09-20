/**
 * Which rules a run judges with: the loaded set, or for `run` the one
 * named by id or by file. Says what it loaded and why it stopped.
 */
import { loadRules, selectRules, shippedRulesPath } from "../rules.ts";
import type { Config } from "../config.ts";
import type { Rule } from "../types.ts";
import type { Log, Options } from "./args.ts";

export function loadOrDie(opts: Options, log: Log): { rules: Rule[]; errors: string[] } | null {
  const { rules, errors, warnings } = loadRules(opts.rules);
  // Judging someone's code against packaged rules is reasonable; doing it
  // without saying so is not, because their cutoffs were fitted to a corpus
  // this code has never seen.
  if (opts.rulesAreShipped && rules.length > 0) {
    log(`no ./rules directory: using the ${rules.length} packaged rule(s) from ${opts.rules[0]}`);
    log(`their cutoffs were fitted to this package's own corpus -- see docs/deepdive.md`);
  }
  // Loudly, always. A rule that failed to load reports nothing, which is
  // indistinguishable from a rule that found nothing wrong.
  for (const e of errors) log(`rule error: ${e}`);
  for (const w of warnings) log(`rule warning: ${w}`);
  if (rules.length === 0) {
    log(`no usable rules found in ${opts.rules.join(", ")}`);
    return null;
  }
  return { rules, errors };
}

export interface Selection {
  rules: Rule[];
  /** `run` becomes `check` or `commits` by what the rule's subjects are. */
  command: string;
  /** A commit range given as a positional; only ever from the command line. */
  rangeArg: string | undefined;
}

/**
 * Null when nothing usable loaded, after saying why. `argPaths` are the
 * positionals as typed: the config's `paths:` fill `opts.paths` when no
 * positional was given, and a path is not a range -- `commits --base <ref>`
 * with `paths: [src]` in the config once judged every commit that touched
 * `src`.
 */
export function selectForRun(command: string, opts: Options, config: Config, argPaths: string[], log: Log): Selection | null {
  let rules: Rule[];
  let rangeArg: string | undefined = argPaths[0];
  // `run`: one rule, chosen by id or by file, then judged exactly as `check`
  // would. The first positional is the rule when it names one; with --file
  // and no such id in the file, it is a path like the rest.
  if (command === "run") {
    const [head, ...tail] = opts.paths;
    const shipped = shippedRulesPath();
    const project = opts.rulesAreShipped ? [] : opts.rules;
    let picked = selectRules({ id: head ?? null, file: opts.file, shipped, projectRules: project });
    let paths = tail;
    if (picked.rules.length === 0 && opts.file && head !== undefined) {
      // Not an id in the file: every positional is a path.
      picked = selectRules({ file: opts.file, shipped, projectRules: project });
      paths = opts.paths;
    }
    rangeArg = argPaths.length > 0 ? paths[0] : undefined;
    for (const e of picked.errors) log(`rule error: ${e}`);
    for (const w of picked.warnings) log(`rule warning: ${w}`);
    if (picked.rules.length === 0) return null;
    rules = picked.rules;
    // The id took the first positional, so the config's `paths:` -- which
    // applies only when no positional was given -- was skipped. Without
    // this, `run <id>` scanned the whole tree while `check` scanned `paths:`.
    opts.paths = paths.length > 0 ? paths : (config.paths ?? []);
    if (!opts.quiet) log(`run: ${rules.map((r) => (r.languageDir ? `${r.languageDir}/${r.id}` : r.id)).join(", ")} from ${picked.from}`);
    // A commit rule's subjects are commits, so `run` with one is `commits`
    // and the positional after the id is a range. Mixing the two kinds in
    // one run has no single source of subjects.
    const commitRuleCount = rules.filter((r) => r.subject === "commit").length;
    if (commitRuleCount === rules.length) command = "commits";
    else if (commitRuleCount > 0) {
      log("run: a commit rule and a file rule cannot run together; name one, or pick a file with one kind");
      return null;
    } else command = "check";
  } else {
    const loaded = loadOrDie(opts, log);
    if (!loaded) return null;
    rules = loaded.rules;
  }

  return { rules, command, rangeArg };
}
