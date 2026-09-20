/**
 * `jev-lint eval`: every rule's fixtures against its baseline; `--compare`
 * for two records of one suite.
 */
import { writeFileSync } from "node:fs";
import { relative } from "node:path";
import { compareEvals, discoverEvals, draftsChanged, loadSuite, planEval, readEvalRecord, recordedAts, runEval, scoreEval } from "../evals.ts";
import type { CaseScore, EvalDiff, EvalRecord, EvalScore, EvalSuite } from "../evals.ts";
import { USD_PER_MTOK, type AskClient } from "../jev.ts";
import type { Options, Log } from "./args.ts";

/**
 * `eval`: every rule directory's fixtures, scored at the shipped cutoff
 * and compared with its baseline.
 *
 * Three modes. Plain: ask, write last.json, compare. `--replay`: no
 * requests -- re-score the baseline at the cutoffs as they are now, which
 * is the free regression gate for CI, and refuse if a rule's question has
 * changed since the baseline was taken. `--accept`: make this run's record
 * the baseline; with `--accept-last`, the previous run's last.json, no
 * requests. Exit 1 on a regression or a stale baseline, so the gate can
 * fail a build.
 */
export async function cmdEval(opts: Options, out: Log, log: Log, client: AskClient | null = null): Promise<number> {
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
          client,
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

    const changedDrafts = draftsChanged(record, rules);
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
      results.push({ suite: suite.name, dir: suite.dir, ok, score, diff, stale: changedDrafts, recorded: record.recorded, passes: record.passes.length });
    } else {
      out(formatEvalSuite(suite, score, diff, wrong, changedDrafts, record, baselineRecord, opts.replay));
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
export function cmdEvalCompare(opts: Options, out: Log, log: Log): number {
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

export function formatEvalSuite(
  suite: EvalSuite,
  score: EvalScore,
  diff: EvalDiff | null,
  wrong: CaseScore[],
  changedDrafts: string[],
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
  if (changedDrafts.length > 0 && replay) {
    lines.push(`  ! the question changed since this baseline for: ${changedDrafts.join(", ")} -- run the eval and accept a new one`);
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
