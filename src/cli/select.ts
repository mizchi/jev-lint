/**
 * Which rules a run judges with: the loaded set, or for `run` the one
 * named by id or by file. Says what it loaded and why it stopped.
 */
import { applyRuleSettings, loadRules, ruleSources, selectRules, shippedRulesPath } from "../rules.ts";
import type { Config } from "../config.ts";
import { isGitSubject } from "../types.ts";
import type { Rule } from "../types.ts";
import type { Log, Options } from "./args.ts";

/**
 * The rules a run judges with, from `-R` or the default sources, narrowed
 * to the config's `rules:` when the config has one. A config with no
 * `rules:` selects nothing, and that is said rather than run as
 * everything: since 0.5 a config chooses its rules, as ESLint's does.
 */
export function loadOrDie(opts: Options, log: Log, baseDir: string = process.cwd(), hasConfig = false): { rules: Rule[]; errors: string[] } | null {
  const sources = opts.rules.length > 0 ? opts.rules : ruleSources(baseDir);
  const { rules: loaded, errors, warnings } = loadRules(sources, opts.languages);
  // Loudly, always. A rule that failed to load reports nothing, which is
  // indistinguishable from a rule that found nothing wrong.
  for (const e of errors) log(`rule error: ${e}`);
  for (const w of warnings) log(`rule warning: ${w}`);
  if (loaded.length === 0) {
    log(`no usable rules found in ${sources.join(", ")}`);
    return null;
  }
  let rules = loaded;
  if (opts.ruleSettings) {
    const selected = applyRuleSettings(loaded, opts.ruleSettings);
    for (const e of selected.errors) log(`config error: rules: ${e}`);
    for (const w of selected.warnings) log(`config warning: rules: ${w}`);
    if (selected.errors.length > 0) return null;
    rules = selected.rules;
    if (rules.length === 0) {
      log("the config's `rules:` turns every rule off; nothing to run");
      return null;
    }
  } else if (hasConfig && opts.rules.length === 0) {
    log("the config names no `rules:`, so nothing runs. List the rules to run -- `rules: { typescript/fn-name-promises: on, ... }` -- or `jev-lint init --force` writes them all");
    return null;
  } else if (opts.rulesAreShipped) {
    // Judging someone's code against packaged rules is reasonable; doing it
    // without saying so is not, because their cutoffs were fitted to a
    // corpus this code has never seen.
    log(`no config: running all ${rules.length} packaged rule(s); their cutoffs were fitted to this package's own corpus -- \`jev-lint init\` writes a config that picks`);
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
export function selectForRun(command: string, opts: Options, config: Config, argPaths: string[], log: Log, baseDir: string = process.cwd(), hasConfig = false): Selection | null {
  let rules: Rule[];
  let rangeArg: string | undefined = argPaths[0];
  // `run`: one rule, chosen by id or by file, then judged exactly as `check`
  // would. The first positional is the rule when it names one; with --file
  // and no such id in the file, it is a path like the rest.
  if (command === "run") {
    const [head, ...tail] = opts.paths;
    const shipped = shippedRulesPath();
    // `run <id>` looks in the shipped packs and `.jev-lint/rules/`, or in
    // the `-R` directories when given; the config's `rules:` does not
    // narrow it -- the id on the command line is the selection.
    const project = opts.rulesAreShipped ? ruleSources(baseDir).filter((s) => s !== shipped) : opts.rules;
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
    opts.paths = paths.length > 0 ? paths : (config.files ?? []);
    if (!opts.quiet) log(`run: ${rules.map((r) => (r.languageDir ? `${r.languageDir}/${r.id}` : r.id)).join(", ")} from ${picked.from}`);
    // A git rule's subjects come from git rather than from a path, so `run`
    // with one is `commits` and the positional after the id is a range.
    // Both git subjects count: a `change` rule reads the same range a
    // `commit` rule does, and counting only `commit` sent it down the file
    // path instead, where the range was taken as a directory name and the
    // run planned nothing at all -- silently, since a path that matches no
    // file is not an error. Mixing the two kinds in one run has no single
    // source of subjects.
    const gitRuleCount = rules.filter((r) => isGitSubject(r.subject)).length;
    if (gitRuleCount === rules.length) command = "commits";
    else if (gitRuleCount > 0) {
      log("run: a git rule and a file rule cannot run together; name one, or pick a file with one kind");
      return null;
    } else command = "check";
  } else {
    const loaded = loadOrDie(opts, log, baseDir, hasConfig);
    if (!loaded) return null;
    rules = loaded.rules;
  }

  return { rules, command, rangeArg };
}
