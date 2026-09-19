#!/usr/bin/env node
/**
 * jevlint -- a natural-language linter.
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
import { readFileSync, writeFileSync } from "node:fs";
import { loadRules, cutoffFor } from "./rules.ts";
import { run, collectSubjects, toRecord } from "./run.ts";
import { changedRanges, changedFiles } from "./diff.ts";
import { gate } from "./gate.ts";
import { gapReport, stabilityReport, fitCutoffs } from "./calibrate.ts";
import {
  formatPretty,
  formatJson,
  formatGithub,
  formatGaps,
  formatStability,
  silentRules,
} from "./report.ts";
import { ARMS, ARM_BLURB } from "./state.ts";
import { DEFAULT_BATCH_SIZE } from "./batch.ts";
import { Cache, DEFAULT_CACHE_PATH } from "./cache.ts";
import { GROUP_MODES, STATE_ARMS } from "./types.ts";
import type { Finding, GroupMode, Labels, Rule, RunResult, StateArm, Subject } from "./types.ts";
import { explain, DEFAULT_RULE_BATCH_CAP, type Schedule } from "./schedule.ts";
import type { ChangedRanges } from "./diff.ts";

/** Everything the command line can set. */
interface Options {
  rules: string[];
  cache: string;
  arm: StateArm | null;
  group: GroupMode;
  ruleBatchCap: number;
  explainSchedule: boolean;
  at: Record<string, number>;
  unsureBelow: number | null;
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
  color: boolean;
  quiet: boolean;
  paths: string[];
  help?: boolean;
}

type Log = (s: string) => void;

const USAGE = `jevlint -- lint rules written as sentences, judged by a model

usage:
  jevlint check [paths...]        judge whole files
  jevlint review [paths...]       judge only what the diff touched
  jevlint gaps [paths...]         per-rule separation report (read this first)
  jevlint calibrate [paths...]    repeat runs, and fit cutoffs if labels exist
  jevlint rules                   list loaded rules and validation errors
  jevlint replay <record.json>    re-score a recorded run, no requests

options:
  -r, --rules <path>       rule file or directory (repeatable; default ./rules)
  -c, --cache <path>       verdict cache (default ${DEFAULT_CACHE_PATH}; "none" to disable)
      --arm <name>         override every rule's state arm: ${ARMS.join(" | ")}
      --group <how>        file (default) | rule | auto -- see below
      --rule-batch-cap <n> subjects per rule-axis request (default ${DEFAULT_RULE_BATCH_CAP})
      --explain-schedule   print the axis chosen per rule, and why
      --at <rule=n>        override one cutoff (repeatable)
      --unsure-below <n>   confidence under which a finding is worded as a question
      --base <ref>         review against a merge base (e.g. --base main)
      --staged             review only staged changes
      --format <fmt>       pretty | json | github
      --concurrency <n>    parallel requests (default 4)
      --batch-size <n>     subjects per request (default ${DEFAULT_BATCH_SIZE})
      --repeat <n>         calibrate: how many times to re-ask (default 3)
      --labels <path>      calibrate or replay: labeled corpus JSON, to fit cutoffs
      --record <path>      write a replayable run record
      --model <id>         Jev model
      --force              ignore cached verdicts
      --dry-run            plan and price the run without asking anything
      --show-missing       list subjects that got no verdict
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
                 false-positive rate, and re-run "jevlint calibrate" afterwards,
                 because a cutoff fitted on one axis is not fitted for the
                 other. --explain-schedule shows what it decided and why.

  A rule can pin its axis with "axis: file" or "axis: rule", which the
  scheduler will not overrule. Pin any rule whose cutoff you calibrated.

environment:
  TYPESAFEAI_API_KEY       required for anything that asks
  TYPESAFEAI_BASE_URL      override the API endpoint
  JEVLINT_AST_GREP         path to an ast-grep binary
`;

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    rules: [],
    cache: DEFAULT_CACHE_PATH,
    arm: null,
    group: "file",
    ruleBatchCap: DEFAULT_RULE_BATCH_CAP,
    explainSchedule: false,
    at: {},
    unsureBelow: null,
    base: null,
    staged: false,
    format: "pretty",
    concurrency: 4,
    batchSize: DEFAULT_BATCH_SIZE,
    repeat: 3,
    labels: null,
    record: null,
    model: null,
    force: false,
    dryRun: false,
    showMissing: false,
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
      case "-r":
      case "--rules":
        opts.rules.push(need(i, a));
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
  if (opts.rules.length === 0) opts.rules = ["rules"];
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
  return opts;
}

function loadOrDie(opts: Options, log: Log): { rules: Rule[]; errors: string[] } | null {
  const { rules, errors } = loadRules(opts.rules);
  // Loudly, always. A rule that failed to load reports nothing, which is
  // indistinguishable from a rule that found nothing wrong.
  for (const e of errors) log(`rule error: ${e}`);
  if (rules.length === 0) {
    log(`no usable rules found in ${opts.rules.join(", ")}`);
    return null;
  }
  return { rules, errors };
}

async function main(argv: string[]): Promise<number> {
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "check";
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
  const cachePath = opts.cache === "none" ? null : opts.cache;

  if (command === "rules") return cmdRules(opts, out, log);
  if (command === "replay") return cmdReplay(opts, out, log);

  const loaded = loadOrDie(opts, log);
  if (!loaded) return 2;
  const { rules } = loaded;

  // Which files to look at.
  let paths = opts.paths;
  let diffRanges: ChangedRanges | null = null;
  if (command === "review") {
    diffRanges = await changedRanges({ base: opts.base, staged: opts.staged });
    const files = changedFiles(diffRanges);
    if (files.length === 0) {
      if (!opts.quiet) out("no changed files");
      return 0;
    }
    // Scan only the changed files: matching the whole tree and discarding
    // everything outside the diff would cost the same as `check`.
    paths = paths.length > 0 ? paths : files;
  } else if (paths.length === 0) {
    paths = ["."];
  }

  if (command === "gaps") return cmdGaps({ rules, paths, diffRanges, opts, cachePath, out, log });
  if (command === "calibrate") {
    return cmdCalibrate({ rules, paths, diffRanges, opts, cachePath, out, log });
  }
  if (command !== "check" && command !== "review") {
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
    model: opts.model,
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
    out(`~${tokens.toLocaleString()} input tokens, ~$${((tokens / 1e6) * 0.042).toFixed(5)}`);
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
  return result.findings.length > 0 ? 1 : 0;
}

function cmdRules(opts: Options, out: Log, log: Log): number {
  const { rules, errors } = loadRules(opts.rules);
  for (const e of errors) log(`rule error: ${e}`);
  for (const r of rules) {
    out(
      `${r.id}\n  ${r.language}  kind=${r.kind}  subject=${r.subject}  arm=${r.state}  cutoff=${cutoffFor(r, opts.at).toFixed(2)}  severity=${r.severity}`,
    );
    out(`  ask: ${r.ask}`);
    if (r.note) out(`  note (model only): ${r.note}`);
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
  });
  const gapsCache = result.cache as Cache | undefined;
  if (gapsCache?.loadError) log(gapsCache.loadError);
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
  if (record.schema !== "jevlint-run-1") {
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
  const gated = gate(results, { cutoffs, unsureBelow: opts.unsureBelow ?? record.unsureBelow });
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
  return gated.findings.length > 0 ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: any) => {
    // A rule set ast-grep would not accept, or a missing key, is a
    // configuration mistake: the message is the useful part and a stack trace
    // only buries it. Anything else is a bug here, and then the stack is what
    // someone needs.
    const configError = err?.name === "AstGrepError" || err?.kind === "auth";
    process.stderr.write(`jevlint: ${configError ? err.message : (err?.stack ?? err)}\n`);
    process.exit(2);
  },
);
