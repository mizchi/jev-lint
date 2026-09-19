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
import { loadRules, cutoffFor } from "./rules.mjs";
import { run, collectSubjects, toRecord } from "./run.mjs";
import { changedRanges, changedFiles } from "./diff.mjs";
import { gate } from "./gate.mjs";
import { gapReport, stabilityReport, fitCutoffs } from "./calibrate.mjs";
import {
  formatPretty,
  formatJson,
  formatGithub,
  formatGaps,
  formatStability,
  silentRules,
} from "./report.mjs";
import { ARMS, ARM_BLURB } from "./state.mjs";
import { DEFAULT_BATCH_SIZE } from "./batch.mjs";
import { DEFAULT_CACHE_PATH } from "./cache.mjs";

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
      --at <rule=n>        override one cutoff (repeatable)
      --unsure-below <n>   confidence under which a finding is worded as a question
      --base <ref>         review against a merge base (e.g. --base main)
      --staged             review only staged changes
      --format <fmt>       pretty | json | github
      --concurrency <n>    parallel requests (default 4)
      --batch-size <n>     subjects per request (default ${DEFAULT_BATCH_SIZE})
      --repeat <n>         calibrate: how many times to re-ask (default 3)
      --labels <path>      calibrate: labeled corpus JSON
      --record <path>      write a replayable run record
      --model <id>         Jev model
      --force              ignore cached verdicts
      --dry-run            plan and price the run without asking anything
      --show-missing       list subjects that got no verdict
      --no-color           plain output
      --quiet              findings only

environment:
  TYPESAFEAI_API_KEY       required for anything that asks
  TYPESAFEAI_BASE_URL      override the API endpoint
  JEVLINT_AST_GREP         path to an ast-grep binary
`;

function parseArgs(argv) {
  const opts = {
    rules: [],
    cache: DEFAULT_CACHE_PATH,
    arm: null,
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
  const need = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
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
        opts.arm = need(i, a);
        i += 1;
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
        opts.format = need(i, a);
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
  if (opts.arm && !ARMS.includes(opts.arm)) {
    throw new Error(`--arm must be one of ${ARMS.join(", ")}`);
  }
  if (!["pretty", "json", "github"].includes(opts.format)) {
    throw new Error(`--format must be pretty, json or github`);
  }
  return opts;
}

function loadOrDie(opts, log) {
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

async function main(argv) {
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "check";
  const rest = argv[0] && !argv[0].startsWith("-") ? argv.slice(1) : argv;
  let opts;
  try {
    opts = parseArgs(rest);
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  if (opts.help || command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }

  const log = (s) => process.stderr.write(`${s}\n`);
  const out = (s) => process.stdout.write(`${s}\n`);
  const cachePath = opts.cache === "none" ? null : opts.cache;

  if (command === "rules") return cmdRules(opts, out, log);
  if (command === "replay") return cmdReplay(opts, out, log);

  const loaded = loadOrDie(opts, log);
  if (!loaded) return 2;
  const { rules } = loaded;

  // Which files to look at.
  let paths = opts.paths;
  let diffRanges = null;
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

  if (result.cache?.loadError) log(result.cache.loadError);
  if (result.stderr?.trim()) log(`ast-grep: ${result.stderr.trim().slice(0, 800)}`);

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

function cmdRules(opts, out, log) {
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

async function cmdGaps({ rules, paths, diffRanges, opts, cachePath, out, log }) {
  const result = await run({
    rules,
    paths,
    arm: opts.arm,
    cutoffs: opts.at,
    diffRanges,
    cachePath,
    force: opts.force,
    concurrency: opts.concurrency,
    batchSize: opts.batchSize,
    model: opts.model,
  });
  if (result.cache?.loadError) log(result.cache.loadError);
  const rows = gapReport(result.all, rules, { cutoffs: opts.at });
  out(formatGaps(rows, { color: opts.color }));
  out("");
  out(
    `${result.stats.subjects} subject(s), ${result.cachedCount} cached, ${result.spent.calls} request(s), $${result.spent.usd.toFixed(5)}`,
  );
  if (opts.format === "json") out(JSON.stringify(rows, null, 2));
  return rows.some((r) => r.verdict === "rewrite" || r.verdict === "silent") ? 1 : 0;
}

async function cmdCalibrate({ rules, paths, diffRanges, opts, cachePath, out, log }) {
  const repeat = Math.max(1, opts.repeat);
  const runs = [];
  let last = null;

  for (let i = 0; i < repeat; i += 1) {
    // Every pass must bypass the cache, or passes 2..N just re-read pass 1 and
    // the spread comes back as zero -- which would be a measurement of the
    // cache, not of the model.
    const r = await run({
      rules,
      paths,
      arm: opts.arm,
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

  if (opts.labels) {
    let labels = null;
    try {
      labels = JSON.parse(readFileSync(opts.labels, "utf8"));
    } catch (err) {
      log(`could not read labels from ${opts.labels}: ${String(err).slice(0, 160)}`);
    }
    if (labels) {
      const fits = fitCutoffs(mergeRuns(runs), labels, rules);
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
      out(
        "A fitted number is a starting point on YOUR corpus, not a calibration for anyone else's.",
      );
    }
  }

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

/** Mean answer per subject across passes, for one gap table over all of them. */
function mergeRuns(runs) {
  const acc = new Map();
  for (const r of runs) {
    for (const f of r) {
      if (typeof f.value !== "number") continue;
      const k = `${f.rule}\u0000${f.file}\u0000${f.line}`;
      if (!acc.has(k)) acc.set(k, { ...f, _n: 0, _sum: 0 });
      const e = acc.get(k);
      e._n += 1;
      e._sum += f.value;
      e.value = e._sum / e._n;
    }
  }
  return [...acc.values()];
}

function cmdReplay(opts, out, log) {
  const path = opts.paths[0];
  if (!path) {
    log("replay needs a record path");
    return 2;
  }
  let record;
  try {
    record = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
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
  const rules = record.rules.map((r) => ({
    ...r,
    matcher: {},
    criteria: null,
    unsureBelow: null,
    message: null,
    docs: null,
  }));
  const byId = new Map(rules.map((r) => [r.id, r]));
  const results = record.answers.map((a) => ({
    subject: {
      rule: byId.get(a.rule) ?? { id: a.rule, kind: a.kind ?? "score", severity: "warning", ask: a.rule },
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
  const result = { ...gated, rules, subjects: results.map((r) => ({ rule: r.subject.rule })), spent: record.spent, cachedCount: 0 };

  if (opts.format === "json") out(formatJson(result));
  else if (opts.format === "github") out(formatGithub(result));
  else out(formatPretty(result, { color: opts.color, showMissing: opts.showMissing }));

  out("");
  out(formatGaps(gapReport(gated.all, rules, { cutoffs }), { color: opts.color }));
  out("");
  out(
    `replayed ${record.answers.length} recorded answer(s) from ${record.recorded} (model ${record.model ?? "unknown"}), 0 requests`,
  );
  const changed = Object.keys(opts.at);
  if (changed.length > 0) out(`cutoffs overridden: ${changed.join(", ")}`);
  return gated.findings.length > 0 ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`jevlint: ${err?.stack ?? err}\n`);
    process.exit(2);
  },
);
