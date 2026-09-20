/**
 * `jev-lint gaps` and `jev-lint calibrate`: separation and cutoffs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Cache } from "../cache.ts";
import { gapReport, stabilityReport, fitCutoffs } from "../calibrate.ts";
import type { ChangedRanges } from "../diff.ts";
import { USD_PER_MTOK } from "../jev.ts";
import { formatGaps, formatStability } from "../report.ts";
import { run, buildRecord } from "../run.ts";
import type { Finding, Labels, Rule, RunResult } from "../types.ts";
import type { Options, Log } from "./args.ts";

export interface CommandArgs {
  rules: Rule[];
  paths: string[];
  diffRanges: ChangedRanges | null;
  opts: Options;
  cachePath: string | null;
  out: Log;
  log: Log;
}

export async function cmdGaps({ rules, paths, diffRanges, opts, cachePath, out, log }: CommandArgs): Promise<number> {
  const result = await run({
    rules,
    paths,
    arm: opts.arm,
    group: opts.group,
    ruleBatchCap: opts.ruleBatchCap,
    cutoffs: opts.at,
    diffRanges,
    exclude: opts.exclude,
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
    writeFileSync(opts.record, `${JSON.stringify(buildRecord(result, { arm: opts.arm, cutoffs: opts.at, unsureBelow: opts.unsureBelow }), null, 2)}\n`);
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

export async function cmdCalibrate({ rules, paths, diffRanges, opts, out, log }: CommandArgs): Promise<number> {
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
      exclude: opts.exclude,
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
        { ...buildRecord(last, { arm: opts.arm, cutoffs: opts.at, unsureBelow: opts.unsureBelow }), passes: runs },
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
export function emitFits(
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
export function mergeRuns(runs: Finding[][]): Finding[] {
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
