#!/usr/bin/env node
/**
 * The grouping experiment: is a state per FILE or a state per RULE better?
 *
 * These are two different bets about where the shared cost lives.
 *
 *   --group file   the state is a file, and every match inside it shares that
 *                  one copy of the source. The file's cost is amortised over
 *                  the matches in it, so this wins when a rule matches many
 *                  things per file -- and pays a whole file for one question
 *                  when it matches once.
 *   --group rule   the state is a rule's matches, from anywhere, each carrying
 *                  its own enclosing function as context. No file is ever sent
 *                  whole. Cost scales with what the matcher CAUGHT rather than
 *                  with the size of the files it caught them in.
 *
 * Which one wins is a question about MATCH DENSITY, and the crossover is what
 * this measures. It also measures the thing rule grouping risks that file
 * grouping does not: two hundred unrelated snippets in one state could anchor
 * each other. A mediocre name looks fine beside a terrible one.
 *
 * The contamination arm is the part worth being careful about. Comparing
 * `--group rule` against `--group file` conflates two changes -- different
 * context AND different neighbours. So each grouping is also run at
 * `--batch-size 1`, which keeps its state shape and removes the neighbours
 * entirely. The neighbour effect is then the difference between a grouping and
 * its own solo baseline, with context held constant.
 *
 * Usage:
 *   node tools/grouping.ts [--repeat 2] [--paths dir,...] [--out path.json]
 *                           [--skip-solo]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadRules, cutoffFor } from "../src/rules.ts";
import { evalCorpus } from "../src/evals.ts";
import { run } from "../src/run.ts";
import { fitCutoffs, labelFor, widestGap } from "../src/calibrate.ts";
import type { Finding, GroupMode, Labels, Rule } from "../src/types.ts";
import type { ScoredSubject } from "../src/calibrate.ts";

/** An answer with its corpus label attached, plus every pass's raw value. */
type Labelled = ScoredSubject & {
  label: "bad" | "clean" | "unlabeled";
  values: number[];
};

function arg(name: string, fallback: string): string;
function arg(name: string, fallback: null): string | null;
function arg(name: string, fallback: string | null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : fallback;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const fitPerConfig = flag("fit-per-config");

const repeat = Number(arg("repeat", "2"));
const paths = arg("paths", "").split(",").filter(Boolean);
const rulePaths = arg("rules", "rules").split(",");
const labelPath = arg("labels", "");
const outPath = arg("out", null);
const concurrency = Number(arg("concurrency", "4"));

const { rules, errors } = loadRules(rulePaths);
for (const e of errors) process.stderr.write(`rule error: ${e}\n`);
if (rules.length === 0) {
  process.stderr.write("no rules\n");
  process.exit(2);
}
// With no --paths/--labels, every rule's evals/ suite is the corpus.
const fromEvals = evalCorpus(rulePaths);
if (paths.length === 0) paths.push(...fromEvals.paths);
const labels = labelPath ? (JSON.parse(readFileSync(labelPath, "utf8")) as Labels) : fromEvals.labels;
const cutoffs = new Map(rules.map((r) => [r.id, cutoffFor(r)]));

/**
 * Configurations, as `group:batchSize` pairs.
 *
 * The default set is the four that decompose the question: each grouping at a
 * full batch, and each at a batch of one. Comparing the two groupings alone
 * changes context AND neighbours at once and cannot say which mattered; the
 * solo runs hold one of those fixed.
 *
 * Override to sweep, e.g. `--configs rule:1,rule:8,rule:32,rule:256` to find
 * where anchoring starts.
 */
const DEFAULT_CONFIGS = "auto:256,file:256,rule:256,file:1,rule:1";

const BLURB: Record<string, string> = {
  "auto:256": "scheduler picks the axis per rule, before asking anything",
  "file:256": "state per file, all its matches share it",
  "rule:256": "state per rule, matches from any file",
  "file:1": "file state, ONE question -- no neighbours",
  "rule:1": "rule state, ONE question -- no neighbours",
};

const CONFIGS = arg("configs", DEFAULT_CONFIGS)
  .split(",")
  .map((spec) => spec.trim())
  .filter(Boolean)
  .map((spec) => {
    const [groupRaw, size] = spec.split(":");
    const group = groupRaw as GroupMode;
    if (!["file", "rule", "auto"].includes(group)) {
      process.stderr.write(`bad --configs entry ${spec}: group must be file, rule or auto\n`);
      process.exit(2);
    }
    const batchSize = Number(size ?? 256);
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      process.stderr.write(`bad --configs entry ${spec}: batch size must be a positive integer\n`);
      process.exit(2);
    }
    // Keep the plain names for the two headline configurations so the report
    // sections that compare them keep working when a sweep adds others.
    const key =
      batchSize === 1 ? `${group}-solo` : batchSize === 256 ? group : `${group}:${batchSize}`;
    return {
      key,
      group,
      batchSize,
      blurb: BLURB[`${group}:${batchSize}`] ?? `${group} grouping, up to ${batchSize} per request`,
    };
  })
  .filter((c) => !(flag("skip-solo") && c.batchSize === 1));

/** Identity of a subject across configurations. Text, not just line. */
const keyOf = (f: ScoredSubject) => `${f.rule}\u0000${f.file}\u0000${f.line}\u0000${f.text ?? ""}`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = <T>(n: T): T | number => (typeof n === "number" ? Math.round(n * 1000) / 1000 : n);

interface ConfigResult {
  key: string;
  group: GroupMode;
  batchSize: number;
  blurb: string;
  /** Cutoffs fitted on THIS configuration's own answers, when asked for. */
  ownCutoffs?: Map<string, number>;
  ownOverall?: ReturnType<typeof scoreOverall>;
  batchesPerPass: number;
  requestsPerPass: number;
  tokensPerPass: number;
  usdPerPass: number;
  msPerPass: number;
  answers: Labelled[];
  perRule: RuleScore[];
  overall: ReturnType<typeof scoreOverall>;
}

type RuleScore = NonNullable<ReturnType<typeof scoreRule>>;

const results: Record<string, ConfigResult> = {};
for (const cfg of CONFIGS) {
  const merged = new Map<string, Labelled & { _n: number; _sum: number }>();
  let spent = { calls: 0, inputTokens: 0, usd: 0, ms: 0 };
  let batches = 0;
  for (let i = 0; i < repeat; i += 1) {
    const r = await run({
      rules,
      paths,
      group: cfg.group,
      batchSize: cfg.batchSize,
      // No cache anywhere: a config that reads another config's verdicts
      // measures the cache, and repeats that read pass one report zero spread.
      cachePath: null,
      force: true,
      concurrency,
    });
    spent = {
      calls: spent.calls + r.spent.calls,
      inputTokens: spent.inputTokens + r.spent.inputTokens,
      usd: spent.usd + r.spent.usd,
      ms: spent.ms + r.spent.ms,
    };
    batches = r.batches.length;
    for (const f of r.all) {
      if (typeof f.value !== "number") continue;
      const k = keyOf(f);
      if (!merged.has(k)) {
        merged.set(k, { ...f, label: "unlabeled", _n: 0, _sum: 0, values: [] });
      }
      const e = merged.get(k)!;
      e._n += 1;
      e._sum += f.value!;
      e.values.push(f.value!);
      e.value = e._sum / e._n;
    }
    process.stderr.write(
      `${cfg.key} pass ${i + 1}/${repeat}: ${r.stats.subjects} subject(s), ` +
        `${r.batches.length} batch(es), ${r.spent.calls} request(s), $${r.spent.usd.toFixed(5)}` +
        `${r.errors?.length ? `, ${r.errors.length} FAILED` : ""}\n`,
    );
  }

  const answers: Labelled[] = [...merged.values()].map((f) => ({
    ...f,
    label: labelFor(labels, f.file, f.line, f.rule),
  }));

  // Fit this configuration's own cutoffs before scoring it, so the comparison
  // varies the configuration and not the threshold it is judged against.
  let ownCutoffs: Map<string, number> | undefined;
  let ownOverall: ReturnType<typeof scoreOverall> | undefined;
  if (fitPerConfig) {
    ownCutoffs = new Map(cutoffs);
    for (const fit of fitCutoffs(answers, labels, rules)) {
      if (typeof fit.fitted === "number") ownCutoffs.set(fit.rule, fit.fitted);
    }
    ownOverall = scoreOverall(answers, ownCutoffs);
  }

  results[cfg.key] = {
    ...cfg,
    ownCutoffs,
    ownOverall,
    batchesPerPass: batches,
    requestsPerPass: Math.round(spent.calls / repeat),
    tokensPerPass: Math.round(spent.inputTokens / repeat),
    usdPerPass: spent.usd / repeat,
    msPerPass: Math.round(spent.ms / repeat),
    answers,
    perRule: rules.map((r) => scoreRule(answers, r)).filter((r): r is RuleScore => r !== null),
    overall: scoreOverall(answers),
  };
}

function scoreRule(answers: Labelled[], rule: Rule) {
  const mine = answers.filter((a) => a.rule === rule.id);
  if (mine.length === 0) return null;
  const at = cutoffs.get(rule.id)!;
  const bad = mine.filter((a) => a.label === "bad").map((a) => a.value!);
  const clean = mine.filter((a) => a.label === "clean").map((a) => a.value!);
  const tp = bad.filter((v) => v >= at).length;
  const fp = clean.filter((v) => v >= at).length;
  return {
    rule: rule.id,
    subjects: mine.length,
    at,
    tp,
    fp,
    fn: bad.length - tp,
    precision: tp + fp > 0 ? round(tp / (tp + fp)) : null,
    recall: bad.length > 0 ? round(tp / bad.length) : null,
    meanBad: round(mean(bad)),
    meanClean: round(mean(clean)),
    separation: bad.length && clean.length ? round(mean(bad)! - mean(clean)!) : null,
    separable: bad.length && clean.length ? Math.min(...bad) > Math.max(...clean) : null,
    gap: round(widestGap(mine.map((a) => a.value!)).gap),
  };
}

function scoreOverall(answers: Labelled[], at: Map<string, number> = cutoffs) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const a of answers) {
    const flagged = a.value! >= at.get(a.rule)!;
    if (a.label === "bad") flagged ? (tp += 1) : (fn += 1);
    else if (a.label === "clean") flagged ? (fp += 1) : (tn += 1);
  }
  return {
    tp,
    fp,
    fn,
    tn,
    precision: tp + fp > 0 ? round(tp / (tp + fp)) : null,
    recall: tp + fn > 0 ? round(tp / (tp + fn)) : null,
  };
}

/**
 * Agreement between two configurations, over the subjects they share.
 *
 * `flips` is the number that matters -- a raw-value difference far from a
 * cutoff changes nothing a user sees, and a small one right at a cutoff changes
 * everything.
 */
function agreement(a: ConfigResult, b: ConfigResult) {
  const byKey = new Map(b.answers.map((x) => [keyOf(x), x]));
  const pairs: Array<[Labelled, Labelled]> = a.answers
    .map((x) => [x, byKey.get(keyOf(x))] as [Labelled, Labelled | undefined])
    .filter((pair): pair is [Labelled, Labelled] => Boolean(pair[1]));
  const deltas = pairs.map(([x, y]) => Math.abs(x.value! - y.value!));
  const flips = pairs.filter(([x, y]) => {
    const at = cutoffs.get(x.rule)!;
    return x.value! >= at !== (y.value! >= at);
  });
  return {
    shared: pairs.length,
    meanAbsDelta: round(mean(deltas) ?? 0),
    maxAbsDelta: round(deltas.length ? Math.max(...deltas) : 0),
    flips: flips.length,
    flipRate: pairs.length ? round(flips.length / pairs.length) : null,
    flipped: flips.slice(0, 12).map(([x, y]) => ({
      rule: x.rule,
      where: `${x.file}:${x.line}`,
      at: cutoffs.get(x.rule)!,
      a: round(x.value!),
      b: round(y.value!),
      label: x.label,
    })),
  };
}

// ------------------------------------------------------------------ report

const out: string[] = [];
const has = (k: string) => Boolean(results[k]);

out.push(`grouping compared over ${repeat} pass(es) on ${paths.join(", ")}`);
out.push("");
out.push("cost and accuracy per configuration:");
out.push(
  `  ${"config".padEnd(11)} ${"req".padEnd(5)} ${"tokens".padEnd(9)} ${"usd".padEnd(9)} ${"ms".padEnd(7)} ${"prec".padEnd(6)} ${"recall".padEnd(7)} tp/fp/fn`,
);
for (const cfg of CONFIGS) {
  const r = results[cfg.key]!;
  const o = r.overall;
  out.push(
    `  ${cfg.key.padEnd(11)} ${String(r.requestsPerPass).padEnd(5)} ` +
      `${r.tokensPerPass.toLocaleString().padEnd(9)} ${("$" + r.usdPerPass.toFixed(5)).padEnd(9)} ` +
      `${String(r.msPerPass).padEnd(7)} ${String(o.precision ?? "-").padEnd(6)} ` +
      `${String(o.recall ?? "-").padEnd(7)} ${o.tp}/${o.fp}/${o.fn}`,
  );
}
if (fitPerConfig) {
  out.push("");
  out.push("the same configurations scored at cutoffs fitted on their OWN answers:");
  out.push(
    `  ${"config".padEnd(11)} ${"prec".padEnd(6)} ${"recall".padEnd(7)} ${"tp/fp/fn".padEnd(10)} rules refitted`,
  );
  for (const cfg of CONFIGS) {
    const r = results[cfg.key]!;
    const o = r.ownOverall;
    if (!o) continue;
    const moved = [...(r.ownCutoffs ?? [])].filter(([k, v]) => cutoffs.get(k) !== v).length;
    out.push(
      `  ${cfg.key.padEnd(11)} ${String(o.precision ?? "-").padEnd(6)} ${String(o.recall ?? "-").padEnd(7)} ` +
        `${`${o.tp}/${o.fp}/${o.fn}`.padEnd(10)} ${moved}`,
    );
  }
  out.push("");
  out.push(
    "  The gap between this table and the one above is how much of any apparent",
  );
  out.push(
    "  accuracy penalty was the CUTOFFS rather than the configuration. Every",
  );
  out.push(
    "  shipped cutoff was fitted on the file axis, so scoring a rule-axis run",
  );
  out.push("  with them measures the axis and the mismatch together.");
}

out.push("");
for (const cfg of CONFIGS) out.push(`  ${cfg.key.padEnd(11)} ${cfg.blurb}`);

if (has("file") && has("rule")) {
out.push("");
out.push("per-rule, file vs rule grouping:");
out.push(
  `  ${"rule".padEnd(36)} ${"file:p/r".padEnd(12)} ${"rule:p/r".padEnd(12)} ${"file sep".padEnd(9)} ${"rule sep".padEnd(9)} verdict`,
);
for (const rule of rules) {
  const f = results.file!.perRule.find((x) => x.rule === rule.id);
  const g = results.rule!.perRule.find((x) => x.rule === rule.id);
  if (!f || !g) continue;
  const pr = (x: RuleScore) => `${x.precision ?? "-"}/${x.recall ?? "-"}`;
  // Identical decisions is the bar. Wider separation is a bonus, not the bar.
  const same = f.tp === g.tp && f.fp === g.fp && f.fn === g.fn;
  const noWorse = g.tp >= f.tp && g.fp <= f.fp;
  const verdict = same ? "same" : noWorse ? "rule better" : "RULE WORSE";
  out.push(
    `  ${rule.id.padEnd(36)} ${pr(f).padEnd(12)} ${pr(g).padEnd(12)} ` +
      `${String(f.separation ?? "-").padEnd(9)} ${String(g.separation ?? "-").padEnd(9)} ${verdict}`,
  );
}
}

const comparisons: Array<[string, string, string]> = [];
if (has("file") && has("rule")) {
  comparisons.push(["file", "rule", "grouping: file vs rule (context AND neighbours differ)"]);
}
// Every batched configuration against its own solo baseline. That is the only
// comparison that isolates the neighbour effect, because the state shape --
// and therefore the context -- is identical on both sides.
for (const cfg of CONFIGS) {
  if (cfg.batchSize === 1 || cfg.group === "auto") continue;
  const solo = `${cfg.group}-solo`;
  if (!has(solo)) continue;
  comparisons.push([
    cfg.key,
    solo,
    `NEIGHBOUR effect at batch ${cfg.batchSize} in ${cfg.group} grouping (context held constant)`,
  ]);
}
if (has("file-solo") && has("rule-solo")) {
  comparisons.push(["file-solo", "rule-solo", "CONTEXT effect alone (both neighbour-free)"]);
}
// The scheduler's invariance: it chooses an axis per rule for cost, so the
// question is whether choosing changed any verdict against either forced axis.
if (has("auto") && has("file")) {
  comparisons.push(["auto", "file", "SCHEDULER vs forced file axis -- did choosing move a verdict?"]);
}
if (has("auto") && has("rule")) {
  comparisons.push(["auto", "rule", "SCHEDULER vs forced rule axis -- did choosing move a verdict?"]);
}

out.push("");
out.push("agreement:");
const agreements: Record<string, ReturnType<typeof agreement>> = {};
for (const [a, b, label] of comparisons) {
  const ag = agreement(results[a]!, results[b]!);
  agreements[`${a}_vs_${b}`] = ag;
  out.push(
    `  ${(a + " vs " + b).padEnd(24)} shared ${String(ag.shared).padEnd(4)} ` +
      `mean |delta| ${String(ag.meanAbsDelta).padEnd(6)} max ${String(ag.maxAbsDelta).padEnd(6)} ` +
      `decision flips ${ag.flips}/${ag.shared} (${((ag.flipRate ?? 0) * 100).toFixed(1)}%)`,
  );
  out.push(`      ${label}`);
  for (const f of ag.flipped) {
    out.push(
      `        ${f.rule} ${f.where} [${f.label}] ${f.a} vs ${f.b} across ${f.at}`,
    );
  }
}

out.push("");
if (has("file") && has("rule")) {
  const f = results.file!;
  const g = results.rule!;
  out.push("bottom line on this corpus:");
  out.push(
    `  requests  ${f.requestsPerPass} -> ${g.requestsPerPass}  (${(f.requestsPerPass / Math.max(1, g.requestsPerPass)).toFixed(1)}x fewer)`,
  );
  out.push(
    `  tokens    ${f.tokensPerPass.toLocaleString()} -> ${g.tokensPerPass.toLocaleString()}  (${((g.tokensPerPass / f.tokensPerPass - 1) * 100).toFixed(0)}%)`,
  );
  out.push(
    `  decisions ${f.overall.tp}/${f.overall.fp}/${f.overall.fn} -> ${g.overall.tp}/${g.overall.fp}/${g.overall.fn}  (tp/fp/fn)`,
  );
  out.push("");
  out.push(
    "  Token cost here is NOT the scaling answer: this corpus is dense (every",
  );
  out.push(
    "  rule matches most functions), which is the case file grouping is built",
  );
  out.push("  for. Run --dry-run on a real repository for the scaling number.");
}

process.stdout.write(`${out.join("\n")}\n`);

if (outPath) {
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        repeat,
        paths,
        configs: CONFIGS.map((c) => c.key),
        cutoffs: Object.fromEntries(cutoffs),
        fitPerConfig,
        results: Object.fromEntries(
          Object.entries(results).map(([k, v]) => [
            k,
            {
              ...v,
              ownCutoffs: v.ownCutoffs ? Object.fromEntries(v.ownCutoffs) : undefined,
              // The full answer list is the evidence; keep it, drop the
              // accumulator fields that are an implementation detail.
              answers: v.answers.map((a) => ({
                rule: a.rule,
                file: a.file,
                line: a.line,
                value: round(a.value),
                values: a.values.map(round),
                label: a.label,
              })),
            },
          ]),
        ),
        agreements,
      },
      null,
      2,
    )}\n`,
  );
  process.stderr.write(`wrote ${outPath}\n`);
}
