/**
 * `jev-lint replay`: re-score a recorded run under other cutoffs, free.
 */
import { readFileSync } from "node:fs";
import { gapReport } from "../calibrate.ts";
import { gate, blocks } from "../gate.ts";
import { formatPretty, formatJson, formatGithub, formatGaps } from "../report.ts";
import type { Finding, Rule, Subject } from "../types.ts";
import type { Options, Log } from "./args.ts";
import { emitFits, mergeRuns } from "./calibrate.ts";

export function cmdReplay(opts: Options, out: Log, log: Log): number {
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
    matcher: r.subject === "commit" || r.subject === "block" ? null : {},
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
  else out(formatPretty(result, { color: opts.color, showMissing: opts.showMissing, summary: opts.summary }));

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
