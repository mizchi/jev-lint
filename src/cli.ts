#!/usr/bin/env node
/**
 * jev-lint -- a natural-language linter.
 *
 * ast-grep decides WHICH code gets looked at. A sentence you write decides
 * WHETHER it is a problem. Jev answers the sentence, in one batched request per
 * file, in a few hundred milliseconds.
 *
 * Commands:
 *   check     judge whole files
 *   review    judge only what a diff touched
 *   gaps      per-rule separation report -- read this before any threshold
 *   calibrate repeat runs and/or fit cutoffs against a labeled corpus
 *   rules     list the loaded rules and every validation error
 *   replay    re-score a recorded run under different cutoffs, for free
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { loadRules, cutoffFor, defaultRulePaths, shippedRulesPath, selectRules } from "./rules.ts";
import { run, collectSubjects, toRecord } from "./run.ts";
import { defaultRange } from "./commits.ts";
import { changedRanges, changedFiles, changedFilesUnder } from "./diff.ts";
import {
  compareEvals,
  discoverEvals,
  draftsChanged,
  loadSuite,
  planEval,
  readEvalRecord,
  recordedAts,
  runEval,
  scoreEval,
  type CaseScore,
  type EvalDiff,
  type EvalRecord,
  type EvalScore,
  type EvalSuite,
} from "./evals.ts";
import { gate, blocks } from "./gate.ts";
import { gapReport, stabilityReport, fitCutoffs } from "./calibrate.ts";
import {
  formatPretty,
  formatJson,
  formatGithub,
  formatGaps,
  formatStability,
  silentRules,
  idleLanguages,
} from "./report.ts";
import { ARMS, ARM_BLURB } from "./state.ts";
import { DEFAULT_BATCH_SIZE } from "./batch.ts";
import { Cache, DEFAULT_CACHE_PATH } from "./cache.ts";
import { USD_PER_MTOK, API_KEY_VARS, BASE_URL_VARS, DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_CONCURRENCY, fromEnv } from "./jev.ts";
import { CONFIG_NAMES, applyConfig, findConfig, initialConfig, initialHook, initialPushHook, loadConfig } from "./config.ts";
import { GROUP_MODES, SEVERITIES, STATE_ARMS, TIER_ONE } from "./types.ts";
import type { Finding, GroupMode, Labels, Rule, RunResult, Severity, StateArm, Subject } from "./types.ts";
import { explain, DEFAULT_RULE_BATCH_CAP, type Schedule } from "./schedule.ts";
import type { ChangedRanges } from "./diff.ts";

/** Everything the command line can set. */
interface Options {
  rules: string[];
  /** True when `rules` is the installed package's own packs, not the project's. */
  rulesAreShipped: boolean;
  /** How many times to ask everything, to see which findings reproduce. */
  retry: number;
  /** An explicit config path, "none" to ignore any file, or null to search. */
  config: string | null;
  baseUrl: string | null;
  cache: string;
  arm: StateArm | null;
  group: GroupMode;
  ruleBatchCap: number;
  explainSchedule: boolean;
  explain: boolean;
  loose: number | null;
  at: Record<string, number>;
  unsureBelow: number | null;
  failOn: Severity | null;
  preCommit: boolean;
  prePush: boolean;
  file: string | null;
  squash: boolean;
  message: string | null;
  accept: boolean;
  acceptLast: boolean;
  replay: boolean;
  compare: boolean;
  base: string | null;
  staged: boolean;
  format: "pretty" | "json" | "github";
  concurrency: number;
  batchSize: number;
  repeat: number;
  labels: string | null;
  record: string | null;
  model: string | null;
  force: boolean;
  dryRun: boolean;
  showMissing: boolean;
  showSubjects: boolean;
  color: boolean;
  quiet: boolean;
  paths: string[];
  help?: boolean;
}

type Log = (s: string) => void;

const USAGE = `jev-lint -- lint rules written as sentences, judged by a model

usage:
  jev-lint check [paths...]        judge whole files
  jev-lint run <rule> [paths...]   judge with one shipped rule: an id (every
                                   language that has it) or rust/<id> (one);
                                   --file <rules.yml> judges with that file's
                                   rules instead, or the one <rule> names in it.
                                   A commit rule runs as commits and takes a range
  jev-lint review [paths...]       judge only what the diff touched
  jev-lint commits [range]         judge commit messages against their diffs
                                   (default @{upstream}..HEAD; or --base <ref>)
  jev-lint commits --squash [range] --message-file <path|->
                                   judge the whole range as one change against
                                   that message: a PR description, a changelog entry
  jev-lint gaps [paths...]         per-rule separation report (read this first)
  jev-lint calibrate [paths...]    repeat runs, and fit cutoffs if labels exist
  jev-lint rules                   list loaded rules and validation errors
  jev-lint replay <record.json>    re-score a recorded run, no requests
  jev-lint eval [dirs...]          run every rule's fixtures against its baseline
  jev-lint eval --compare a.json b.json   two records of one suite, case by case, no requests
  jev-lint init                   write a .jev-lint.yaml to start from
  jev-lint init --pre-commit      write a pre-commit hook that reviews the staged diff
  jev-lint init --pre-push        write a pre-push hook that judges the commits about to leave

options:
      --file <path>        run: a rule file to use instead of the shipped rules
      --squash             commits: the range as one diff, judged against --message
      --message <text>     commits --squash: the claim about the range
      --message-file <p>   commits --squash: the same, from a file, or - for stdin
      --config <path>      config file (default: nearest .jev-lint.yaml,
                           searching upwards); --no-config ignores it
      --base-url <url>     the API endpoint (default ${DEFAULT_BASE_URL})
  -R, --rules <path>       rule file or directory (repeatable; default ./rules,
                           else the packs inside the installed package)
  -r, --retry <n>          ask everything n times and report what reproduces
                           (default 1). Above 1 the verdict cache is bypassed,
                           since a cached answer reproduces itself.
  -c, --cache <path>       verdict cache (default ${DEFAULT_CACHE_PATH}; "none" to disable)
      --arm <name>         override every rule's state arm: ${ARMS.join(" | ")}
      --group <how>        file (default) | rule | auto -- see below
      --rule-batch-cap <n> subjects per rule-axis request (default ${DEFAULT_RULE_BATCH_CAP})
      --explain            after the verdicts, ask each finding which of its
                           rule's explain: labels names why (one extra
                           request per batch with findings; nothing under a
                           cutoff is asked)
      --loose [n]          also list the band under each cutoff -- at or over
                           the rule's loose: floor, else half its cutoff -- for
                           a reader, closest to the cutoff first, at most n.
                           Never a finding: does not count, does not fail. Free.
      --explain-schedule   print the axis chosen per rule, and why
      --at <rule=n>        override one cutoff (repeatable); rust/<rule>=n for one language
      --unsure-below <n>   confidence under which a finding is worded as a question
      --base <ref>         review against a merge base (e.g. --base main)
      --staged             review only staged changes, as a pre-commit hook does
      --fail-on <severity> exit 1 only for findings at or above hint | info |
                           warning | error (default: any finding)
      --format <fmt>       pretty | json | github
      --concurrency <n>    most requests in flight at once (default ${DEFAULT_CONCURRENCY}; a 429 narrows it)
      --batch-size <n>     subjects per request (default ${DEFAULT_BATCH_SIZE})
      --repeat <n>         calibrate: how many times to re-ask (default 3)
      --labels <path>      calibrate or replay: labeled corpus JSON, to fit cutoffs
      --record <path>      write a replayable run record
      --model <id>         Jev model
      --force              ignore cached verdicts
      --accept             eval: run, then make that run the baseline
      --accept-last        eval: make the previous run (last.json) the baseline, no requests
      --replay             eval: re-score each baseline at the current cutoffs, no requests
      --compare            eval: the two positional records, scored at their own cutoffs
      --dry-run            plan and price the run without asking anything
      --show-missing       list subjects that got no verdict
      --show-subjects      with --dry-run: list every subject the matchers found,
                           with its node kind and captures -- the free way to
                           see what a rule would ask about, and about what
      --no-color           plain output
      --quiet              findings only

batching:
  The axis moves verdicts, and most of that is the CUTOFF, not the axis. On
  this repository's corpus, 276 subjects, the two axes disagree on 1.4% of
  decisions. Judged at the shipped cutoffs -- which were fitted on the file
  axis -- the rule axis loses 1 true positive and gains 1 false positive.
  Refit on its own answers it recovers most of that, and what is left is 1
  fewer true positive and 2 more false positives out of 276: a real direction
  on too few events to size. So the accurate axis is the default, the cheap one
  is opt-in, and switching axis means re-fitting.

  --group file   DEFAULT. One state per file: the file's source, then every
                 match in it. The source is amortised over the matches, so a
                 dense rule is cheap and a rule matching once in a large file
                 pays for the whole file.
  --group rule   One state per rule: only what the matcher caught, from any
                 number of files. Far fewer requests -- 3.3x fewer planned on
                 tokio at the default cap -- and no file ever sent whole, at
                 the cost of accuracy above and of a cutoff that has to be
                 refitted. It carries a match's enclosing function only where the
                 match is a FRAGMENT inside one, so a rule matching whole
                 functions gets no context and lands on "bare".
                 Switching axis also invalidates every cached verdict, because
                 the axis is part of the cache key.
  --group auto   Cost both axes per rule before asking anything, and pick the
                 cheaper. Opt in when the token bill matters more than the
                 false-positive rate, and re-run "jev-lint calibrate" afterwards,
                 because a cutoff fitted on one axis is not fitted for the
                 other. --explain-schedule shows what it decided and why.

  A rule can pin its axis with "axis: file" or "axis: rule", which the
  scheduler will not overrule. Pin any rule whose cutoff you calibrated.

environment:
  ${API_KEY_VARS[0]}         required for anything that asks
  ${API_KEY_VARS[1]}       accepted as a fallback
  ${BASE_URL_VARS[0]}        override the API endpoint
  JEV_LINT_MODEL           override the model
  JEV_LINT_AST_GREP        path to an ast-grep binary

  A flag beats .jev-lint.yaml, and the file beats these defaults. The API key
  is read from the environment only -- never from the config file, which
  belongs in version control.
`;

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    rules: [],
    rulesAreShipped: false,
    retry: 1,
    config: null,
    baseUrl: null,
    cache: DEFAULT_CACHE_PATH,
    arm: null,
    group: "file",
    ruleBatchCap: DEFAULT_RULE_BATCH_CAP,
    explainSchedule: false,
    explain: false,
    loose: null,
    at: {},
    unsureBelow: null,
    failOn: null,
    preCommit: false,
    prePush: false,
    file: null,
    squash: false,
    message: null,
    accept: false,
    acceptLast: false,
    replay: false,
    compare: false,
    base: null,
    staged: false,
    format: "pretty",
    concurrency: DEFAULT_CONCURRENCY,
    batchSize: DEFAULT_BATCH_SIZE,
    repeat: 3,
    labels: null,
    record: null,
    model: null,
    force: false,
    dryRun: false,
    showMissing: false,
    showSubjects: false,
    color: process.stdout.isTTY === true && !process.env.NO_COLOR,
    quiet: false,
    paths: [],
  };
  const need = (i: number, flag: string): string => {
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
    return argv[i + 1]!;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case "-R":
      case "--rules":
        opts.rules.push(need(i, a));
        i += 1;
        break;
      case "-r":
      case "--retry":
        opts.retry = Number(need(i, a));
        i += 1;
        break;
      case "--config":
        opts.config = need(i, a);
        i += 1;
        break;
      case "--no-config":
        opts.config = "none";
        break;
      case "--base-url":
        opts.baseUrl = need(i, a);
        i += 1;
        break;
      case "-c":
      case "--cache":
        opts.cache = need(i, a);
        i += 1;
        break;
      case "--arm":
        opts.arm = need(i, a) as StateArm;
        i += 1;
        break;
      case "--group":
        opts.group = need(i, a) as GroupMode;
        i += 1;
        break;
      case "--rule-batch-cap":
        opts.ruleBatchCap = Number(need(i, a));
        i += 1;
        break;
      case "--explain":
        opts.explain = true;
        break;
      case "--loose": {
        // An optional count: `--loose 20` caps the band, `--loose` alone
        // lists all of it. The next argument is the count only if it is one.
        const next = argv[i + 1];
        if (next !== undefined && /^\d+$/.test(next)) {
          opts.loose = Number(next);
          i += 1;
        } else {
          opts.loose = Infinity;
        }
        break;
      }
      case "--explain-schedule":
        opts.explainSchedule = true;
        break;
      case "--at": {
        const v = need(i, a);
        const eq = v.lastIndexOf("=");
        if (eq < 1) throw new Error(`--at needs rule=number, got ${v}`);
        const n = Number(v.slice(eq + 1));
        if (!Number.isFinite(n)) throw new Error(`--at ${v}: not a number`);
        opts.at[v.slice(0, eq)] = n;
        i += 1;
        break;
      }
      case "--unsure-below":
        opts.unsureBelow = Number(need(i, a));
        i += 1;
        break;
      case "--fail-on": {
        const v = need(i, a);
        if (!(SEVERITIES as readonly string[]).includes(v)) {
          throw new Error(`--fail-on must be one of ${SEVERITIES.join(", ")} (got ${v})`);
        }
        opts.failOn = v as Severity;
        i += 1;
        break;
      }
      case "--pre-push":
        opts.prePush = true;
        break;
      case "--file":
        opts.file = need(i, a);
        i += 1;
        break;
      case "--squash":
        opts.squash = true;
        break;
      case "--message":
        opts.message = need(i, a);
        i += 1;
        break;
      case "--message-file": {
        // `-` is stdin, so `gh pr view --json title,body -q ... | jev-lint
        // commits --squash --message-file -` needs no temporary file.
        const path = need(i, a);
        opts.message = readFileSync(path === "-" ? 0 : path, "utf8");
        i += 1;
        break;
      }
      case "--pre-commit":
        opts.preCommit = true;
        break;
      case "--accept":
        opts.accept = true;
        break;
      case "--accept-last":
        opts.accept = true;
        opts.acceptLast = true;
        break;
      case "--replay":
        opts.replay = true;
        break;
      case "--compare":
        opts.compare = true;
        break;
      case "--base":
        opts.base = need(i, a);
        i += 1;
        break;
      case "--staged":
        opts.staged = true;
        break;
      case "--format":
        opts.format = need(i, a) as Options["format"];
        i += 1;
        break;
      case "--concurrency":
        opts.concurrency = Number(need(i, a));
        i += 1;
        break;
      case "--batch-size":
        opts.batchSize = Number(need(i, a));
        i += 1;
        break;
      case "--repeat":
        opts.repeat = Number(need(i, a));
        i += 1;
        break;
      case "--labels":
        opts.labels = need(i, a);
        i += 1;
        break;
      case "--record":
        opts.record = need(i, a);
        i += 1;
        break;
      case "--model":
        opts.model = need(i, a);
        i += 1;
        break;
      case "--force":
        opts.force = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--show-missing":
        opts.showMissing = true;
        break;
      case "--show-subjects":
        opts.showSubjects = true;
        break;
      case "--no-color":
        opts.color = false;
        break;
      case "--quiet":
        opts.quiet = true;
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      default:
        if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
        opts.paths.push(a);
    }
  }
  if (opts.rules.length === 0) {
    const [paths, shipped] = defaultRulePaths();
    opts.rules = paths;
    opts.rulesAreShipped = shipped;
  }
  if (opts.arm && !STATE_ARMS.includes(opts.arm)) {
    throw new Error(`--arm must be one of ${ARMS.join(", ")}`);
  }
  if (!["pretty", "json", "github"].includes(opts.format)) {
    throw new Error(`--format must be pretty, json or github`);
  }
  if (!GROUP_MODES.includes(opts.group)) {
    throw new Error(`--group must be ${GROUP_MODES.join(", ")}`);
  }
  if (!Number.isInteger(opts.ruleBatchCap) || opts.ruleBatchCap < 1) {
    throw new Error(`--rule-batch-cap must be a positive integer`);
  }
  if (!Number.isInteger(opts.retry) || opts.retry < 1) {
    throw new Error(`--retry must be a positive integer (1 asks once)`);
  }
  return opts;
}

/**
 * `jev-lint init`: write a config to start from.
 *
 * Refuses to overwrite without `--force`, because the file it would replace is
 * the one holding someone's calibrated cutoffs.
 */
function cmdInit(opts: Options, out: Log, log: Log): number {
  if (opts.preCommit) return cmdInitHook(opts, out, log, "pre-commit");
  if (opts.prePush) return cmdInitHook(opts, out, log, "pre-push");
  const target = opts.config && opts.config !== "none" ? opts.config : CONFIG_NAMES[0];
  if (existsSync(target) && !opts.force) {
    log(`${target} already exists; pass --force to overwrite it`);
    return 2;
  }
  try {
    writeFileSync(target, initialConfig());
  } catch (err: unknown) {
    log(`could not write ${target}: ${String(err).slice(0, 160)}`);
    return 2;
  }

  out(`wrote ${target}`);
  out("");
  const key = fromEnv(API_KEY_VARS);
  if (key) {
    out(`${API_KEY_VARS[0]} is set. Next:`);
  } else {
    out(`Set your API key, then run:`);
    out(`  export ${API_KEY_VARS[0]}=...`);
  }
  out(`  npx jev-lint check src --dry-run   # what it would ask, and the price`);
  out(`  npx jev-lint check src             # ask it`);
  out("");
  out("Everything in the file is commented out, so it changes nothing until you");
  out("uncomment a line. The shipped rules' cutoffs were fitted to this");
  out("package's own corpus -- see `jev-lint gaps` and `jev-lint calibrate`");
  out("before trusting them on your code.");
  return 0;
}

/**
 * `init --pre-commit`: write the hook into the repository's hooks directory.
 *
 * Asked of git rather than assumed to be `.git/hooks`, because a worktree's
 * hooks live in the main repository and `core.hooksPath` can move them
 * anywhere. An existing hook is never overwritten without `--force`: it is
 * probably husky's or a task runner's, and the right move there is one line
 * added to it, which is printed.
 */
function cmdInitHook(opts: Options, out: Log, log: Log, which: "pre-commit" | "pre-push"): number {
  let hooksDir: string;
  try {
    hooksDir = execFileSync("git", ["rev-parse", "--git-path", "hooks"], { encoding: "utf8" }).trim();
  } catch {
    log(`not inside a git repository, so there is nowhere to put a ${which} hook`);
    return 2;
  }
  const target = join(hooksDir, which);
  const line =
    which === "pre-commit"
      ? "npx -y jev-lint review --staged --fail-on error"
      : "npx -y jev-lint commits '@{upstream}..HEAD' --fail-on error";
  if (existsSync(target) && !opts.force) {
    log(`${target} already exists; pass --force to overwrite it, or add this line to it:`);
    log(`  ${line}`);
    return 2;
  }
  try {
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(target, which === "pre-commit" ? initialHook() : initialPushHook(), { mode: 0o755 });
  } catch (err: unknown) {
    log(`could not write ${target}: ${String(err).slice(0, 160)}`);
    return 2;
  }
  out(`wrote ${target}`);
  out("");
  if (which === "pre-commit") {
    out("It reviews the staged diff on every commit, prints what it finds, and");
    out("blocks only on a rule with `severity: error` -- no shipped rule has it.");
    out("With no API key in the environment it steps aside. Skip it once with");
    out("`git commit --no-verify`; remove it by deleting the file.");
  } else {
    out("It judges the commits not yet on the upstream -- does each message");
    out("describe its diff -- prints what it finds, and blocks only on a rule");
    out("with `severity: error`. With no API key, or no upstream yet, it steps");
    out("aside. Skip it once with `git push --no-verify`; remove it by deleting the file.");
  }
  return 0;
}

function loadOrDie(opts: Options, log: Log): { rules: Rule[]; errors: string[] } | null {
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

async function main(argv: string[]): Promise<number> {
  let command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "check";
  const rest = argv[0] && !argv[0].startsWith("-") ? argv.slice(1) : argv;
  let opts: Options;
  try {
    opts = parseArgs(rest);
  } catch (err: unknown) {
    process.stderr.write(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (opts.help || command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }

  const log: Log = (s) => process.stderr.write(`${s}\n`);
  const out: Log = (s) => process.stdout.write(`${s}\n`);

  if (command === "init") return cmdInit(opts, out, log);

  // A flag beats the file and the file beats the built-in default, which is the
  // only order that lets a project commit a configuration and still let someone
  // override one setting for one run. `explicit` is how that is enforced: it
  // records which flags were actually PASSED, since a parsed default is
  // indistinguishable from one the user typed.
  const explicit = new Set(rest.filter((a) => a.startsWith("-")));
  // `paths:` in the config is what `check` looks at with no argument. It is
  // not what `eval` looks at: its positional arguments are rule directories,
  // and with none it walks the rule sources.
  const argPaths = [...opts.paths];
  const configPath =
    opts.config === "none" ? null : (opts.config ?? findConfig());
  if (opts.config && opts.config !== "none" && !existsSync(opts.config)) {
    log(`config not found: ${opts.config}`);
    return 2;
  }
  const { config, errors: configErrors } = loadConfig(configPath);
  // Loudly, and fatally. A config with a typo in it is a configuration that
  // does something other than what it says, which is worse than no config.
  for (const e of configErrors) log(`config error: ${e}`);
  if (configErrors.length > 0) return 2;
  applyConfig(opts, config, explicit);
  if (configPath && !opts.quiet) log(`using ${configPath}`);

  const cachePath = opts.cache === "none" ? null : opts.cache;

  if (command === "rules") return cmdRules(opts, out, log);
  if (command === "replay") return cmdReplay(opts, out, log);
  if (command === "eval") return cmdEval({ ...opts, paths: argPaths }, out, log);

  // `run`: one rule, chosen by id or by file, then judged exactly as `check`
  // would. The first positional is the rule when it names one; with --file
  // and no such id in the file, it is a path like the rest.
  let rules: Rule[];
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
    for (const e of picked.errors) log(`rule error: ${e}`);
    for (const w of picked.warnings) log(`rule warning: ${w}`);
    if (picked.rules.length === 0) return 2;
    rules = picked.rules;
    opts.paths = paths;
    if (!opts.quiet) log(`run: ${rules.map((r) => (r.languageDir ? `${r.languageDir}/${r.id}` : r.id)).join(", ")} from ${picked.from}`);
    // A commit rule's subjects are commits, so `run` with one is `commits`
    // and the positional after the id is a range. Mixing the two kinds in
    // one run has no single source of subjects.
    const commitRules = rules.filter((r) => r.subject === "commit").length;
    if (commitRules === rules.length) command = "commits";
    else if (commitRules > 0) {
      log("run: a commit rule and a file rule cannot run together; name one, or pick a file with one kind");
      return 2;
    } else command = "check";
  } else {
    const loaded = loadOrDie(opts, log);
    if (!loaded) return 2;
    rules = loaded.rules;
  }

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
    if (files.length === 0) {
      if (!opts.quiet) out("no changed files");
      return 0;
    }
    paths = files;
  } else if (command === "commits") {
    // The range is a positional (`main..HEAD`), else `--base <ref>`, else
    // what is not yet pushed. A repository with no upstream and no `--base`
    // has no default worth guessing at.
    const range = opts.paths[0] ?? (opts.base ? `${opts.base}..HEAD` : defaultRange());
    if (!range) {
      log("commits: no range. Give one (`main..HEAD`), or --base <ref>, or set an upstream");
      return 2;
    }
    if (!rules.some((r) => r.subject === "commit")) {
      log("commits: no `subject: commit` rule is loaded; the shipped one is rules/git/commit-message-describes-diff");
      return 2;
    }
    if (opts.squash && opts.message === null) {
      log("commits --squash needs the message to judge the range against: --message <text> or --message-file <path|->");
      return 2;
    }
    if (!opts.squash && opts.message !== null) {
      log("commits: --message is for --squash; each commit has its own message");
      return 2;
    }
    commitsRange = range;
    paths = [];
  } else if (paths.length === 0) {
    paths = ["."];
  }

  if (command === "gaps") return cmdGaps({ rules, paths, diffRanges, opts, cachePath, out, log });
  if (command === "calibrate") {
    return cmdCalibrate({ rules, paths, diffRanges, opts, cachePath, out, log });
  }
  if (command !== "check" && command !== "review" && command !== "commits") {
    log(`unknown command \`${command}\``);
    process.stderr.write(USAGE);
    return 2;
  }

  const result = await run({
    rules,
    paths,
    arm: opts.arm,
    group: opts.group,
    ruleBatchCap: opts.ruleBatchCap,
    cutoffs: opts.at,
    unsureBelow: opts.unsureBelow,
    diffRanges,
    cachePath,
    force: opts.force,
    dryRun: opts.dryRun,
    concurrency: opts.concurrency,
    batchSize: opts.batchSize,
    retry: opts.retry,
    explain: opts.explain,
    loose: opts.loose,
    model: opts.model,
    commits: commitsRange ? { range: commitsRange, ...(opts.squash ? { squash: opts.message! } : {}) } : null,
  });

  const runCache = result.cache as Cache | undefined;
  if (runCache?.loadError) log(runCache.loadError);
  if (result.stderr?.trim()) log(`ast-grep: ${result.stderr.trim().slice(0, 800)}`);

  if (result.schedule && (opts.explainSchedule || opts.dryRun)) {
    out(explain(result.schedule as Schedule));
    out("");
  }

  if (opts.dryRun) {
    out(`${result.subjects.length} subject(s), ${result.cachedCount} already cached`);
    out(`${result.batches.length} request(s) planned`);
    const tokens = result.batches.reduce((a, b) => a + b.estimatedTokens, 0);
    for (const b of result.batches.slice(0, 40)) {
      out(
        `  ${b.file}  ${b.subjects.length} subject(s)  arm ${b.arm}  ~${b.estimatedTokens.toLocaleString()} tok` +
          (b.degraded ? `  (fell back from ${b.degraded.from}: ${b.degraded.reason})` : ""),
      );
    }
    if (result.batches.length > 40) out(`  … and ${result.batches.length - 40} more`);
    out(`~${tokens.toLocaleString()} input tokens, ~$${((tokens / 1e6) * USD_PER_MTOK).toFixed(5)}`);
    // A count says the matcher fired; it does not say on what. Listing the
    // subjects is how a rule author checks that a matcher found the four
    // predicates and not the loader, and that `$NAME` captured a name -- the
    // two things a wrong matcher gets wrong while producing a plausible count.
    if (result.commits) {
      out(`${result.commits.total} commit(s) in ${result.commits.range}` + (result.commits.skippedMerges ? `, ${result.commits.skippedMerges} merge(s) skipped` : ""));
      for (const s of result.subjects) {
        const ref = /^[0-9a-f]{40}$/.test(s.file) ? s.file.slice(0, 8) : s.file;
        out(`  ${ref}  "${s.captured?.SUBJECT ?? ""}"  ${s.commit?.files.length ?? 0} file(s)${s.commit?.truncated ? "  diff cut to fit" : ""}`);
      }
    }
    if (opts.showSubjects && !result.commits) {
      out("");
      out(`${result.subjects.length} subject(s):`);
      for (const s of result.subjects) {
        const where = s.line === s.endLine ? `${s.line}` : `${s.line}-${s.endLine}`;
        const caps = s.captured && Object.keys(s.captured).length > 0
          ? "  " + Object.entries(s.captured).map(([k, v]) => `$${k}=${JSON.stringify(v)}`).join(" ")
          : "";
        const judged = s.promoted ? `  judged: ${s.rule.subject}` : "";
        out(`  ${s.file}:${where}  ${s.rule.id}  ${s.nodeKind}${judged}${caps}`);
      }
    }
    // A dry run is what someone checks a suppression with -- it is the free way
    // to confirm an ignore comment covers what they meant it to.
    if (result.ignored && (result.ignored.subjects > 0 || result.ignored.files.length > 0)) {
      out(
        `${result.ignored.subjects} subject(s) skipped by jev-lint-ignore comments` +
          (result.ignored.files.length ? `, ${result.ignored.files.length} file(s) whole` : ""),
      );
    }
    if (result.ignored?.unknownRules.length) {
      log(
        `jev-lint-ignore comment(s) name a rule that does not exist: ${result.ignored.unknownRules.join(", ")}`,
      );
    }
    if (result.unpaired && result.unpaired.subjects > 0) {
      out(
        `${result.unpaired.subjects} subject(s) on the paired arm would not be asked: no related test file for ` +
          `${result.unpaired.files.length} file(s)`,
      );
    }
    if (result.retry && result.retry > 1) {
      out(`--retry ${result.retry}: every request above would be made ${result.retry} times`);
    }
    const idle = idleLanguages(result);
    if (idle.length && !result.commits) out(`no files for ${idle.map((l) => `${l.language} (${l.rules})`).join(", ")}`);
    const silent = silentRules(result);
    if (silent.length) out(`${silent.length} rule(s) matched nothing: ${silent.join(", ")}`);
    return 0;
  }

  if (opts.record) {
    writeFileSync(
      opts.record,
      `${JSON.stringify(toRecord(result, { arm: opts.arm, cutoffs: opts.at, unsureBelow: opts.unsureBelow }), null, 2)}\n`,
    );
    log(`recorded ${result.all.length} answer(s) to ${opts.record}`);
  }

  if (opts.format === "json") out(formatJson(result));
  else if (opts.format === "github") out(formatGithub(result));
  else out(formatPretty(result, { color: opts.color, showMissing: opts.showMissing }));

  // Exit 1 when something was reported, 0 when clean. A request failure is not
  // a finding, but it must not read as success either -- hence 3.
  if (result.errors?.length && result.findings.length === 0) return 3;
  return blocks(result.findings, opts.failOn) ? 1 : 0;
}

/**
 * `eval`: every rule directory's fixtures, scored at the shipped cutoff
 * and compared with its baseline.
 *
 * Three modes. Plain: ask, write last.json, compare. `--replay`: no
 * requests -- re-score the baseline at the cutoffs as they are now, which
 * is the free regression gate for CI, and refuse if a rule's question has
 * changed since the baseline was taken. `--accept`: copy last.json over
 * baseline.json, after a run or on its own. Exit 1 on a regression or a
 * stale baseline, so the gate can fail a build.
 */
async function cmdEval(opts: Options, out: Log, log: Log): Promise<number> {
  if (opts.compare) return cmdEvalCompare(opts, out, log);
  const roots = opts.paths.length > 0 ? opts.paths : opts.rules;
  const suites = discoverEvals(roots);
  if (suites.length === 0) {
    log(`no evals under ${roots.join(", ")}: a suite is a rule directory holding expect.yml and fixtures/`);
    return 2;
  }
  let failed = 0;
  const results: Array<Record<string, unknown>> = [];
  for (const suite of suites) {
    const { rules, labels, errors } = loadSuite(suite);
    for (const e of errors) log(`${suite.name}: ${e}`);
    if (errors.length > 0 || rules.length === 0) {
      failed += 1;
      continue;
    }
    const baselineRecord = readEvalRecord(suite.baseline, suite);
    let record: EvalRecord | null = null;
    if (opts.replay) {
      if (!baselineRecord) {
        log(`${suite.name}: no baseline to replay (run \`jev-lint eval ${suite.dir} --accept\` once)`);
        failed += 1;
        continue;
      }
      record = baselineRecord;
    } else if (opts.accept && opts.acceptLast) {
      record = readEvalRecord(suite.last, suite);
      if (!record) {
        log(`${suite.name}: no last run to accept`);
        failed += 1;
        continue;
      }
    }
    if (!record && opts.dryRun) {
      // Plan and price, ask nothing: the same promise `check --dry-run` makes.
      try {
        const plan = await planEval(suite, opts.repeat);
        out(`${suite.name}: ${plan.subjects} subject(s), ${plan.requests} request(s) over ${opts.repeat} pass(es), ~${plan.tokens.toLocaleString()} input tokens, ~$${((plan.tokens / 1e6) * USD_PER_MTOK).toFixed(5)}`);
      } catch (err: unknown) {
        log(`${suite.name}: ${String((err as Error)?.message ?? err).slice(0, 240)}`);
        failed += 1;
      }
      continue;
    }
    if (!record) {
      try {
        record = await runEval(suite, {
          repeat: opts.repeat,
          cutoffs: opts.at,
          concurrency: opts.concurrency,
          model: opts.model,
          log: (line) => {
            if (!opts.quiet) log(line);
          },
        });
      } catch (err: unknown) {
        log(`${suite.name}: ${String((err as Error)?.message ?? err).slice(0, 240)}`);
        failed += 1;
        continue;
      }
    }

    const stale = draftsChanged(record, rules);
    const score = scoreEval(record.passes, labels, rules, opts.at);
    let diff: EvalDiff | null = null;
    if (baselineRecord) {
      // The accepted state is the contract: the baseline's answers, decided at
      // the cutoffs it was accepted with. A case that was wrong then is known;
      // what fails the gate is a case that was right then and is wrong now --
      // because the cutoff moved (replay) or the answers did (a run) -- or a
      // question that changed under the baseline.
      const accepted = scoreEval(baselineRecord.passes, labels, rules, opts.at, recordedAts(baselineRecord));
      diff = compareEvals(accepted, score, { draftChanged: draftsChanged(baselineRecord, rules).length > 0 });
    }

    const wrong = score.cases.filter((c) => c.label !== "unlabeled" && !c.right);
    // With a baseline, the gate is the comparison; without one, the cases.
    const ok = diff ? diff.ok : wrong.length === 0;
    if (!ok) failed += 1;

    if (opts.format === "json") {
      results.push({ suite: suite.name, dir: suite.dir, ok, score, diff, stale, recorded: record.recorded, passes: record.passes.length });
    } else {
      out(formatEvalSuite(suite, score, diff, wrong, stale, record, baselineRecord, opts.replay));
    }

    if (opts.accept && !opts.replay) {
      writeFileSync(suite.baseline, `${JSON.stringify(record, null, 2)}\n`);
      if (!opts.quiet) log(`${suite.name}: baseline accepted (${record.passes.length} pass(es), ${record.recorded})`);
    }
  }
  if (opts.format === "json") out(JSON.stringify({ suites: results, failed }, null, 2));
  else out(failed === 0 ? `${suites.length} suite(s), all as shipped` : `${failed} of ${suites.length} suite(s) failed`);
  return failed === 0 ? 0 : 1;
}

/**
 * `eval --compare a.json b.json`: two records of one suite -- two models,
 * two days, two revisions -- scored each at the cutoffs it was taken with
 * and compared case by case. Neither is the contract, so a changed question
 * between them is said, not refused. The suite is found from the records'
 * `suite` name under the rule sources, for its labels and its rule.
 */
function cmdEvalCompare(opts: Options, out: Log, log: Log): number {
  const [a, b] = opts.paths;
  if (!a || !b) {
    log("eval --compare needs two record paths");
    return 2;
  }
  const left = readEvalRecord(a);
  const right = readEvalRecord(b);
  if (!left || !right) {
    log(`${!left ? a : b} is not an eval record`);
    return 2;
  }
  if (left.suite !== right.suite) {
    log(`the records are of different suites: ${left.suite} and ${right.suite}`);
    return 2;
  }
  const suite = discoverEvals(opts.rules).find((s) => s.name === left.suite);
  if (!suite) {
    log(`no suite named ${left.suite} under ${opts.rules.join(", ")}; pass -R <dir> to say where it is`);
    return 2;
  }
  const { rules, labels, errors } = loadSuite(suite);
  for (const e of errors) log(`${suite.name}: ${e}`);
  if (errors.length > 0) return 2;
  const scoreL = scoreEval(left.passes, labels, rules, {}, recordedAts(left));
  const scoreR = scoreEval(right.passes, labels, rules, {}, recordedAts(right));
  const drafts = new Map(left.rules.map((r) => [r.id, r.draft]));
  const changed = right.rules.filter((r) => drafts.has(r.id) && drafts.get(r.id) !== r.draft).map((r) => r.id);
  const diff = compareEvals(scoreL, scoreR, { draftChanged: false });
  const rel = (f: string) => relative(suite.fixtures, f);
  const side = (name: string, rec: EvalRecord, sc: EvalScore) => {
    out(`${name}: ${rec.recorded.slice(0, 19)}  model ${rec.model ?? "?"}  ${rec.passes.length} pass(es)`);
    for (const r of sc.rules) {
      const fmt = (n: number | null) => (n === null ? "-" : n.toFixed(2));
      out(`  ${r.rule.padEnd(36)} at ${String(r.at).padEnd(5)} tp ${r.tp} fp ${r.fp} fn ${r.fn}  P ${fmt(r.precision)} R ${fmt(r.recall)}  flips ${r.flips}`);
    }
  };
  side(`A ${a}`, left, scoreL);
  side(`B ${b}`, right, scoreR);
  if (changed.length) out(`the question changed between A and B for: ${changed.join(", ")}`);
  out(`B against A: ${diff.regressions.length} worse, ${diff.improvements.length} better, ${diff.added.length} new, ${diff.removed.length} gone`);
  for (const c of diff.regressions) out(`  - ${rel(c.file)}:${c.line}  ${c.rule}  ${c.label}: A ${c.was}, B ${c.now} (${c.mean.toFixed(2)})`);
  for (const c of diff.improvements) out(`  + ${rel(c.file)}:${c.line}  ${c.rule}  ${c.label}: A ${c.was}, B ${c.now} (${c.mean.toFixed(2)})`);
  // Per case, both means side by side, for the eye.
  const keyOf = (c: CaseScore) => `${c.rule}\u0000${c.file}\u0000${c.line}`;
  const byKey = new Map(scoreL.cases.map((c) => [keyOf(c), c]));
  const moved = scoreR.cases
    .map((c) => ({ c, l: byKey.get(keyOf(c)) }))
    .filter((x) => x.l && Math.abs(x.l.mean - x.c.mean) >= 0.1)
    .sort((x, y) => Math.abs(y.c.mean - y.l!.mean) - Math.abs(x.c.mean - x.l!.mean));
  if (moved.length) {
    out(`moved by 0.10 or more:`);
    for (const { c, l } of moved.slice(0, 20)) out(`  ${rel(c.file)}:${c.line}  ${c.rule}  ${c.label}  ${l!.mean.toFixed(2)} -> ${c.mean.toFixed(2)}`);
  }
  return diff.regressions.length > 0 ? 1 : 0;
}

function formatEvalSuite(
  suite: EvalSuite,
  score: EvalScore,
  diff: EvalDiff | null,
  wrong: CaseScore[],
  stale: string[],
  record: EvalRecord,
  baseline: EvalRecord | null,
  replay: boolean,
): string {
  const lines: string[] = [];
  const passes = record.passes.length;
  lines.push(`${suite.name}  (${suite.dir}; ${replay ? "baseline" : "run"} of ${record.recorded.slice(0, 10)}, ${passes} pass(es))`);
  lines.push(`  ${"rule".padEnd(36)} ${"at".padEnd(5)} ${"tp".padStart(3)} ${"fp".padStart(3)} ${"fn".padStart(3)}  ${"P".padEnd(5)} ${"R".padEnd(5)} ${"flips".padEnd(5)} ${"cleanTop".padEnd(8)} fitted`);
  const fmt = (n: number | null) => (n === null ? "-" : n.toFixed(2));
  for (const r of score.rules) {
    lines.push(
      `  ${r.rule.padEnd(36)} ${String(r.at).padEnd(5)} ${String(r.tp).padStart(3)} ${String(r.fp).padStart(3)} ${String(r.fn).padStart(3)}  ${fmt(r.precision).padEnd(5)} ${fmt(r.recall).padEnd(5)} ${String(r.flips).padEnd(5)} ${String(r.cleanTop ?? "-").padEnd(8)} ${r.fitted ?? "-"}  ${r.fitReason}`,
    );
  }
  const rel = (f: string) => relative(suite.fixtures, f);
  const vals = (c: CaseScore) => `[${c.values.map((v) => v.toFixed(2)).join(" ")}]`;
  for (const c of wrong) {
    lines.push(`  x ${rel(c.file)}:${c.line}  ${c.rule}  ${c.label} but ${c.decision} at ${c.mean.toFixed(2)} ${vals(c)}`);
  }
  for (const c of score.cases.filter((c) => c.flip && c.right)) {
    const at = score.rules.find((r) => r.rule === c.rule)?.at;
    lines.push(`  ~ ${rel(c.file)}:${c.line}  ${c.rule}  ${c.label}, right on the mean but ${vals(c)} across ${at}`);
  }
  if (stale.length > 0 && replay) {
    lines.push(`  ! the question changed since this baseline for: ${stale.join(", ")} -- run the eval and accept a new one`);
  }
  if (diff && baseline) {
    const head = replay
      ? `  vs the decisions accepted with it:`
      : `  vs baseline of ${baseline.recorded.slice(0, 10)} (${baseline.passes.length} pass(es)):`;
    const quiet = diff.reasons.length === 0 && diff.improvements.length === 0 && diff.added.length === 0 && diff.removed.length === 0;
    if (quiet) {
      lines.push(`${head} same decisions`);
    } else {
      lines.push(head);
      for (const r of diff.reasons) lines.push(`    ! ${r}`);
      for (const c of diff.regressions) lines.push(`    - ${rel(c.file)}:${c.line}  ${c.rule}  ${c.label}: was ${c.was}, now ${c.now} (${c.mean.toFixed(2)})`);
      for (const c of diff.improvements) lines.push(`    + ${rel(c.file)}:${c.line}  ${c.rule}  ${c.label}: was ${c.was}, now ${c.now} (${c.mean.toFixed(2)})`);
      for (const c of diff.added) lines.push(`    ? ${rel(c.file)}:${c.line}  ${c.rule}  new subject, ${c.decision} at ${c.mean.toFixed(2)}`);
      for (const c of diff.removed) lines.push(`    ? ${rel(c.file)}:${c.line}  ${c.rule}  subject gone from the cases`);
    }
  } else if (!baseline) {
    lines.push(`  no baseline yet: \`jev-lint eval ${suite.dir} --accept\` makes this one`);
  }
  lines.push("");
  return lines.join("\n");
}

function cmdRules(opts: Options, out: Log, log: Log): number {
  const { rules, errors, warnings } = loadRules(opts.rules);
  for (const e of errors) log(`rule error: ${e}`);
  for (const w of warnings) log(`rule warning: ${w}`);
  for (const r of rules) {
    out(
      `${r.languageDir ? `${r.languageDir}/` : ""}${r.id}\n  ${r.languages.join(", ")}  kind=${r.kind}  subject=${r.subject}  arm=${r.state}  cutoff=${cutoffFor(r, opts.at).toFixed(2)}  severity=${r.severity}`,
    );
    out(`  ask: ${r.ask}`);
    if (r.note) out(`  note (model only): ${r.note}`);
    if (r.explain) out(`  explain (--explain): ${Object.keys(r.explain).join(" | ")}`);
    if (r.loose !== null) out(`  loose floor (--loose): ${r.loose}`);
    // A shipped rule outside the first tier may ship without a baseline;
    // say so where the cutoff is printed, since that cutoff was never fitted.
    if (r.languageDir && r.source && !existsSync(join(dirname(r.source), "baseline.json"))) {
      out(`  uncalibrated: no baseline.json beside it${(TIER_ONE as readonly string[]).includes(r.languageDir) ? " -- a tier-one rule must have one" : ""}`);
    }
    out(`  from: ${r.source}`);
  }
  out("");
  out(`${rules.length} rule(s) loaded, ${errors.length} error(s)`);
  out("");
  out("state arms:");
  for (const a of ARMS) out(`  ${a.padEnd(9)} ${ARM_BLURB[a]}`);
  return errors.length > 0 ? 2 : 0;
}

interface CommandArgs {
  rules: Rule[];
  paths: string[];
  diffRanges: ChangedRanges | null;
  opts: Options;
  cachePath: string | null;
  out: Log;
  log: Log;
}

async function cmdGaps({ rules, paths, diffRanges, opts, cachePath, out, log }: CommandArgs): Promise<number> {
  const result = await run({
    rules,
    paths,
    arm: opts.arm,
    group: opts.group,
    ruleBatchCap: opts.ruleBatchCap,
    cutoffs: opts.at,
    diffRanges,
    cachePath,
    force: opts.force,
    concurrency: opts.concurrency,
    batchSize: opts.batchSize,
    model: opts.model,
    dryRun: opts.dryRun,
  });
  const gapsCache = result.cache as Cache | undefined;
  if (gapsCache?.loadError) log(gapsCache.loadError);
  if (opts.dryRun) {
    // The same promise every command makes of the flag: plan, price, ask
    // nothing. It was accepted here and ignored.
    const tokens = result.batches.reduce((a, b) => a + b.estimatedTokens, 0);
    out(`${result.subjects.length} subject(s), ${result.cachedCount} already cached, ${result.batches.length} request(s) planned, ~${tokens.toLocaleString()} input tokens, ~$${((tokens / 1e6) * USD_PER_MTOK).toFixed(5)}`);
    return 0;
  }
  if (opts.record) {
    writeFileSync(opts.record, `${JSON.stringify(toRecord(result, { arm: opts.arm, cutoffs: opts.at, unsureBelow: opts.unsureBelow }), null, 2)}\n`);
    log(`recorded to ${opts.record}`);
  }
  const rows = gapReport(result.all, rules, { cutoffs: opts.at });
  out(formatGaps(rows, { color: opts.color }));
  out("");
  out(
    `${result.stats.subjects} subject(s), ${result.cachedCount} cached, ${result.spent.calls} request(s), $${result.spent.usd.toFixed(5)}`,
  );
  if (opts.format === "json") out(JSON.stringify(rows, null, 2));
  return rows.some((r) => r.verdict === "rewrite" || r.verdict === "silent") ? 1 : 0;
}

async function cmdCalibrate({ rules, paths, diffRanges, opts, out, log }: CommandArgs): Promise<number> {
  const repeat = Math.max(1, opts.repeat);
  const runs: Finding[][] = [];
  let last: RunResult | null = null;

  for (let i = 0; i < repeat; i += 1) {
    // Every pass must bypass the cache, or passes 2..N just re-read pass 1 and
    // the spread comes back as zero -- which would be a measurement of the
    // cache, not of the model.
    const r = await run({
      rules,
      paths,
      arm: opts.arm,
      group: opts.group,
      ruleBatchCap: opts.ruleBatchCap,
      cutoffs: opts.at,
      diffRanges,
      cachePath: null,
      force: true,
      concurrency: opts.concurrency,
      batchSize: opts.batchSize,
      model: opts.model,
    });
    runs.push(r.all);
    last = r;
    log(
      `pass ${i + 1}/${repeat}: ${r.stats.subjects} subject(s), ${r.stats.reported} reported, ${r.spent.calls} request(s), $${r.spent.usd.toFixed(5)}`,
    );
  }

  out(formatGaps(gapReport(mergeRuns(runs), rules, { cutoffs: opts.at }), { color: opts.color }));
  out("");
  if (repeat > 1) {
    out(formatStability(stabilityReport(runs, rules, { cutoffs: opts.at }), { color: opts.color }));
    out("");
  }

  emitFits(opts.labels, mergeRuns(runs), rules, out, log);

  if (opts.record && last) {
    writeFileSync(
      opts.record,
      `${JSON.stringify(
        { ...toRecord(last, { arm: opts.arm, cutoffs: opts.at, unsureBelow: opts.unsureBelow }), passes: runs },
        null,
        2,
      )}\n`,
    );
    log(`recorded ${repeat} pass(es) to ${opts.record}`);
  }
  return 0;
}

/**
 * Fit a cutoff per rule against a labeled corpus, and print the table.
 *
 * Shared by `calibrate`, which fits the answers it just paid for, and by
 * `replay`, which fits recorded ones for free. The second is the one that makes
 * a cutoff auditable: a shipped cutoff is a claim about a specific set of
 * answers, and anyone holding the record can re-derive it without an API key.
 */
function emitFits(
  labelPath: string | null,
  all: Finding[],
  rules: Rule[],
  out: Log,
  log: Log,
): void {
  if (!labelPath) return;
  let labels: Labels | null = null;
  try {
    labels = JSON.parse(readFileSync(labelPath, "utf8")) as Labels;
  } catch (err: unknown) {
    log(`could not read labels from ${labelPath}: ${String(err).slice(0, 160)}`);
    return;
  }

  const fits = fitCutoffs(all, labels, rules);
  out("fitted cutoffs (against the labeled corpus):");
  for (const f of fits) {
    if (f.fitted === null) {
      out(`  ${f.rule.padEnd(28)} -        ${f.reason}`);
      continue;
    }
    out(
      `  ${f.rule.padEnd(28)} ${String(f.fitted).padEnd(6)} ` +
        `precision ${f.precision ?? "-"} recall ${f.recall ?? "-"} ` +
        `(tp ${f.tp} fp ${f.fp} fn ${f.fn})  ${f.reason}`,
    );
  }
  out("");
  out("Apply with --at rule=value, or write `at:` into the rule file.");
  out("A fitted number is a starting point on YOUR corpus, not a calibration for anyone else's.");
  out(
    "Refit after changing --group: a cutoff belongs to an axis. Refitting these rules on " +
      "rule-axis answers changed 4 of 216 decisions, and one rule stopped separating at any cutoff.",
  );
}

/**
 * Mean answer per subject across passes, for one gap table over all of them.
 *
 * The identity includes the subject's TEXT, not just its line. One line can
 * hold several subjects for one rule -- `const a = 1, b = 2;` is two bindings
 * -- and keying on the line alone silently averaged them together, so the gap
 * table saw fewer subjects than the run actually judged.
 */
function mergeRuns(runs: Finding[][]): Finding[] {
  const acc = new Map<string, Finding & { _n: number; _sum: number }>();
  for (const r of runs) {
    for (const f of r) {
      if (typeof f.value !== "number") continue;
      const k = `${f.rule}\u0000${f.file}\u0000${f.line}\u0000${f.text ?? ""}`;
      if (!acc.has(k)) acc.set(k, { ...f, _n: 0, _sum: 0 });
      const e = acc.get(k)!;
      e._n += 1;
      e._sum += f.value!;
      e.value = e._sum / e._n;
    }
  }
  return [...acc.values()];
}

function cmdReplay(opts: Options, out: Log, log: Log): number {
  const path = opts.paths[0];
  if (!path) {
    log("replay needs a record path");
    return 2;
  }
  let record: any;
  try {
    record = JSON.parse(readFileSync(path, "utf8"));
  } catch (err: unknown) {
    log(`could not read ${path}: ${String(err).slice(0, 160)}`);
    return 2;
  }
  if (record.schema !== "jev-lint-run-1") {
    log(`${path}: unexpected schema ${record.schema}`);
    return 2;
  }

  // Replay uses the RECORDED rule drafts, not whatever is on disk now. A
  // recorded answer answered the question as it was worded then, and scoring it
  // against a rewritten sentence would silently mix two questions.
  const rules: Rule[] = record.rules.map((r: any) => ({
    ...r,
    matcher: {},
    criteria: null,
    unsureBelow: null,
    message: null,
    docs: null,
  }));
  const byId = new Map<string, Rule>(rules.map((r) => [r.id, r]));
  const results = record.answers.map((a: any) => ({
    subject: {
      rule: (byId.get(a.rule) ?? {
        id: a.rule,
        kind: a.kind ?? "score",
        severity: "warning",
        ask: a.rule,
      }) as Rule,
      file: a.file,
      line: a.line,
      endLine: a.endLine,
      text: "",
      arm: a.arm,
    },
    answer: typeof a.value === "number" ? { value: a.value, confidence: a.confidence, kind: a.kind } : null,
  }));

  const cutoffs = { ...(record.cutoffs ?? {}), ...opts.at };
  const gated = gate(results, { cutoffs, unsureBelow: opts.unsureBelow ?? record.unsureBelow, loose: opts.loose });
  const result = {
    ...gated,
    rules,
    subjects: results.map((r: any) => ({ rule: r.subject.rule })) as Subject[],
    spent: record.spent,
    cachedCount: 0,
  };

  if (opts.format === "json") out(formatJson(result));
  else if (opts.format === "github") out(formatGithub(result));
  else out(formatPretty(result, { color: opts.color, showMissing: opts.showMissing }));

  // A `calibrate --repeat n` record carries every pass, and its top-level
  // `answers` is only the last one. The gap and fit tables average the passes,
  // exactly as calibrate did when it printed them -- scoring one pass here
  // would make a replayed table disagree with the one the cutoff came from.
  const passes: Finding[][] = Array.isArray(record.passes) ? record.passes : [];
  const analysed = passes.length > 0 ? mergeRuns(passes) : (gated.all as Finding[]);

  out("");
  out(formatGaps(gapReport(analysed, rules, { cutoffs }), { color: opts.color }));
  out("");
  emitFits(opts.labels, analysed, rules, out, log);
  out(
    `replayed ${record.answers.length} recorded answer(s) from ${record.recorded} (model ${record.model ?? "unknown"}), 0 requests`,
  );
  if (passes.length > 1) {
    out(`gap and fit tables are the mean of ${passes.length} recorded pass(es)`);
  }
  const changed = Object.keys(opts.at);
  if (changed.length > 0) out(`cutoffs overridden: ${changed.join(", ")}`);
  return blocks(gated.findings, opts.failOn) ? 1 : 0;
}

main(process.argv.slice(2)).then(
  // Not `process.exit(code)`: when stdout is a pipe, exit discards whatever
  // has not been flushed yet, and a `--format json` report over a few hundred
  // subjects is longer than the pipe buffer. Setting the exit code lets the
  // event loop drain stdout first, and nothing here keeps the loop alive.
  (code) => {
    process.exitCode = code;
  },
  (err: any) => {
    // A rule set ast-grep would not accept, or a missing key, is a
    // configuration mistake: the message is the useful part and a stack trace
    // only buries it. Anything else is a bug here, and then the stack is what
    // someone needs.
    const configError = err?.name === "AstGrepError" || err?.kind === "auth";
    process.stderr.write(`jev-lint: ${configError ? err.message : (err?.stack ?? err)}\n`);
    process.exit(2);
  },
);
