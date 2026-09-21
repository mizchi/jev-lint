/**
 * `jev-lint check`, `review` and `commits`: one run over the targets, then
 * the report in the format asked for, or the plan when `--dry-run`.
 */
import { writeFileSync } from "node:fs";
import { Cache } from "../cache.ts";
import type { AskClient } from "../jev.ts";
import { blocks } from "../gate.ts";
import { formatGithub, formatJson, formatPretty } from "../report.ts";
import { run, buildRecord } from "../run.ts";
import { explain, type Schedule } from "../schedule.ts";
import type { Rule } from "../types.ts";
import type { Log, Options } from "./args.ts";
import { printDryRun } from "./dry-run.ts";
import type { Targets } from "./targets.ts";

export async function cmdCheck(
  rules: Rule[],
  { paths, diffRanges, commitsRange }: Targets,
  opts: Options,
  cachePath: string | null,
  out: Log,
  log: Log,
  client: AskClient | null = null,
): Promise<number> {
  const result = await run({
    rules,
    paths,
    arm: opts.arm,
    group: opts.group,
    ruleBatchCap: opts.ruleBatchCap,
    cutoffs: opts.at,
    unsureBelow: opts.unsureBelow,
    diffRanges,
    exclude: opts.exclude,
    cachePath,
    force: opts.force,
    dryRun: opts.dryRun,
    concurrency: opts.concurrency,
    batchSize: opts.batchSize,
    retry: opts.retry,
    explain: opts.explain,
    loose: opts.loose,
    model: opts.model,
    languages: opts.languages,
    client,
    commits: commitsRange ? { range: commitsRange, ...(opts.squash ? { squash: opts.message! } : {}) } : null,
  });


  const runCache = result.cache as Cache | undefined;
  if (runCache?.loadError) log(runCache.loadError);
  if (result.stderr?.trim()) log(`ast-grep: ${result.stderr.trim().slice(0, 800)}`);

  if (result.schedule && (opts.explainSchedule || opts.dryRun)) {
    // Prose for a reader; under --json stdout is the document alone.
    const say = opts.format === "json" ? log : out;
    say(explain(result.schedule as Schedule));
    say("");
  }


  if (opts.dryRun) return printDryRun(result, rules, opts, out, log);

  if (opts.record) {
    writeFileSync(
      opts.record,
      `${JSON.stringify(buildRecord(result, { arm: opts.arm, cutoffs: opts.at, unsureBelow: opts.unsureBelow }), null, 2)}\n`,
    );
    log(`recorded ${result.all.length} answer(s) to ${opts.record}`);
  }

  if (opts.format === "json") out(formatJson(result));
  else if (opts.format === "github") out(formatGithub(result));
  else out(formatPretty(result, { color: opts.color, showMissing: opts.showMissing, summary: opts.summary }));

  // Exit 1 when something was reported, 0 when clean. A request failure is not
  // a finding, but it must not read as success either -- hence 3.
  if (result.errors?.length && result.findings.length === 0) return 3;
  return blocks(result.findings, opts.failOn) ? 1 : 0;
}
