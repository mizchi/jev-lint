/**
 * What a run would ask, and what it would cost, printed instead of asking:
 * the plan, its price, the price per rule, the commits or subjects it found,
 * and everything the matcher side of a run can say without a request.
 */
import { costByRule, formatCostByRule } from "../cost.ts";
import { USD_PER_MTOK } from "../jev.ts";
import { idleLanguages, silentRules } from "../report.ts";
import type { Rule, RunResult } from "../types.ts";
import type { Log, Options } from "./args.ts";

export function printDryRun(result: RunResult, rules: Rule[], opts: Options, out: Log, log: Log): number {
  if (opts.format === "json") {
    out(JSON.stringify(dryRunDocument(result, rules, opts), null, 2));
    if (result.ignored?.unknownRules.length) {
      log(`jev-lint-ignore comment(s) name a rule that does not exist: ${result.ignored.unknownRules.join(", ")}`);
    }
    return 0;
  }
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
  // Per rule, dearest first: which rule to drop, or run alone, is a
  // decision the total cannot inform.
  if (rules.length > 1 && result.batches.length > 0) {
    out("");
    out(formatCostByRule(costByRule(result.batches, rules)));
  }
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

/** The plan as one document: what the text says, as fields. */
export function dryRunDocument(result: RunResult, rules: Rule[], opts: Options): Record<string, unknown> {
  const tokens = result.batches.reduce((a, b) => a + b.estimatedTokens, 0);
  return {
    dryRun: true,
    subjects: result.subjects.length,
    cached: result.cachedCount ?? 0,
    requests: result.batches.length,
    tokens,
    usd: (tokens / 1e6) * USD_PER_MTOK,
    retry: result.retry ?? 1,
    batches: result.batches.map((b) => ({
      file: b.file,
      rule: b.rule ?? null,
      subjects: b.subjects.length,
      arm: b.arm,
      tokens: b.estimatedTokens,
      degraded: b.degraded ? { from: b.degraded.from, to: b.degraded.to, reason: b.degraded.reason } : null,
    })),
    byRule: costByRule(result.batches, rules),
    commits: result.commits
      ? {
          ...result.commits,
          subjects: result.subjects.map((s) => ({ sha: s.file, subject: s.captured?.SUBJECT ?? "", files: s.commit?.files.length ?? 0, truncated: s.commit?.truncated ?? false })),
        }
      : null,
    ...(opts.showSubjects && !result.commits
      ? {
          subjectList: result.subjects.map((s) => ({
            file: s.file,
            line: s.line,
            endLine: s.endLine,
            rule: s.rule.id,
            node: s.nodeKind,
            judged: s.promoted ? s.rule.subject : null,
            captured: s.captured ?? {},
          })),
        }
      : {}),
    ignored: result.ignored ?? null,
    unpaired: result.unpaired ?? null,
    excluded: result.excluded ?? 0,
    undeclared: result.undeclared ?? [],
    idleLanguages: idleLanguages(result),
    silentRules: silentRules(result),
  };
}
