/**
 * The command line: every option, the usage text, and the parser that
 * turns `argv` into `Options`. The parser reads nothing but its arguments;
 * the terminal's colour and a `--message-file` are read by `main`.
 */
import { DEFAULT_BATCH_SIZE } from "../batch.ts";
import type { AskClient } from "../jev.ts";
import { DEFAULT_CACHE_PATH } from "../cache.ts";
import { API_KEY_VARS, BASE_URL_VARS, DEFAULT_BASE_URL, DEFAULT_CONCURRENCY } from "../jev.ts";
import { defaultRulePaths } from "../rules.ts";
import { DEFAULT_RULE_BATCH_CAP } from "../schedule.ts";
import { ARMS } from "../state.ts";
import { GROUP_MODES, SEVERITIES, STATE_ARMS } from "../types.ts";
import type { GroupMode, Severity, StateArm } from "../types.ts";

/** Everything the command line can set. */
export interface Options {
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
  /** `--message-file`: read after parsing, so the parser reads nothing. */
  messageFile: string | null;
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
  summary: boolean;
  showSubjects: boolean;
  color: boolean;
  quiet: boolean;
  paths: string[];
  exclude: string[];
  help?: boolean;
}

export type Log = (s: string) => void;

/**
 * What a command reaches the world through, injectable: the model client
 * (`null` builds a `Jev` from the environment), and the two output streams.
 * A test hands in a client that answers without a network and collects
 * what was printed, and runs a command exactly as the terminal would.
 */
export interface Deps {
  client?: AskClient | null;
  out?: Log;
  log?: Log;
}

export const USAGE = `jev-lint -- lint rules written as sentences, judged by a model

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
      --config <path>      config file (default: the nearest .jev-lint.yaml --
                           or jev-lint.yaml, .jevlint.yml, any spelling of it --
                           searching upwards; two in one directory is an error);
                           --no-config ignores it
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
      --json               --format json: one JSON document on stdout, for every
                           command; what a reader would be told goes to stderr
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
      --summary            the findings counted by rule, and by file densest first
      --exclude <path>     a path under the roots whose files are never judged (repeatable;
                           \`exclude:\` in the config)
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

export function parseArgs(argv: string[], { color }: { color: boolean }): Options {
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
    messageFile: null,
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
    summary: false,
    showSubjects: false,
    color,
    quiet: false,
    paths: [],
    exclude: [],
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
      case "--message-file":
        opts.messageFile = need(i, a);
        i += 1;
        break;
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
      case "--json":
        opts.format = "json";
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
      case "--summary":
        opts.summary = true;
        break;
      case "--exclude":
        opts.exclude.push(need(i, a));
        i += 1;
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
