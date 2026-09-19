#!/usr/bin/env node
/**
 * The state-arm experiment.
 *
 * Runs the whole corpus once per state arm and reports precision and recall per
 * (rule, arm). It answers the only question about state that matters: for THIS
 * judgment, does more context help, hurt, or do nothing?
 *
 * There is a real expectation to test here rather than a hope. Published
 * measurements on a closely related rule shape found that adding the
 * surrounding file cut false positives to a fifth and increased misses at the
 * same time -- context makes a verdict MILDER. If that holds, the right arm is
 * not "the most context available" but "the least context that still contains
 * the answer", and it differs per rule:
 *
 *   - a judgment about a function's name against its body is answerable from
 *     the function alone, so the file can only dilute it
 *   - a judgment about a binding's name against its value may NOT be, because
 *     `const timeoutSeconds = 5000` is only wrong if you know 5000 is
 *     milliseconds, and that is visible in the usage rather than the
 *     declaration
 *   - a judgment about a module's name has no local evidence at all
 *
 * Usage:
 *   node tools/arms.ts [--repeat 1] [--arms bare,located,graph,full]
 *                       [--rules rules] [--paths corpus] [--out path.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadRules } from "../src/rules.ts";
import { run } from "../src/run.ts";
import { labelFor } from "../src/calibrate.ts";
import { widestGap } from "../src/calibrate.ts";
import { ARMS } from "../src/state.ts";
import type { Finding, Labels, Rule, StateArm } from "../src/types.ts";
import type { ScoredSubject } from "../src/calibrate.ts";

/** An answer with its corpus label attached, which is what scoring reads. */
type Labelled = ScoredSubject & { label: "bad" | "clean" | "unlabeled"; values?: number[] };

function arg(name: string, fallback: string): string;
function arg(name: string, fallback: null): string | null;
function arg(name: string, fallback: string | null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : fallback;
}

const repeat = Number(arg("repeat", "1"));
const arms = arg("arms", ARMS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean) as StateArm[];
const rulePaths = arg("rules", "rules").split(",");
const paths = arg("paths", "corpus").split(",");
const outPath = arg("out", null);
const labelPath = arg("labels", "corpus/labels.json");

const { rules, errors } = loadRules(rulePaths);
for (const e of errors) process.stderr.write(`rule error: ${e}\n`);
if (rules.length === 0) {
  process.stderr.write("no rules\n");
  process.exit(2);
}
const labels = JSON.parse(readFileSync(labelPath, "utf8")) as Labels;

/**
 * Score one arm's answers against the labels.
 *
 * The cutoff used here is the one fitted to THIS arm's own answers, not a
 * number carried over from another arm. Comparing arms at a shared cutoff would
 * measure the cutoff rather than the arm: an arm that shifts every answer down
 * by 0.2 would look broken when it had merely rescaled.
 */
function scoreArm(all: Labelled[], rule: Rule) {
  const answers: Labelled[] = all
    .filter((f) => f.rule === rule.id && typeof f.value === "number")
    .map((f) => ({ ...f, label: labelFor(labels, f.file, f.line, f.rule) }));

  const bad = answers.filter((a) => a.label === "bad").map((a) => a.value!);
  const clean = answers.filter((a) => a.label === "clean").map((a) => a.value!);
  if (answers.length === 0) return null;

  const separable = bad.length > 0 && clean.length > 0 && Math.min(...bad) > Math.max(...clean);
  let at;
  if (separable) at = (Math.max(...clean) + Math.min(...bad)) / 2;
  else if (bad.length > 0) {
    // No separating cutoff: take the one maximising true minus false positives,
    // so the row shows the best this arm can do rather than the worst.
    let best = { at: 0.5, gain: -Infinity };
    for (const v of [...new Set(answers.map((a) => a.value!))].sort((x, y) => x - y)) {
      const tp = bad.filter((b) => b >= v).length;
      const fp = clean.filter((c) => c >= v).length;
      if (tp - fp > best.gain) best = { at: v, gain: tp - fp };
    }
    at = best.at;
  } else at = 0.5;

  const tp = bad.filter((v) => v >= at).length;
  const fn = bad.length - tp;
  const fp = clean.filter((v) => v >= at).length;
  const gap = widestGap(answers.map((a) => a.value!)).gap;

  return {
    rule: rule.id,
    subjects: answers.length,
    bad: bad.length,
    clean: clean.length,
    at: round(at),
    tp,
    fp,
    fn,
    precision: tp + fp > 0 ? round(tp / (tp + fp)) : null,
    recall: bad.length > 0 ? round(tp / bad.length) : null,
    separable,
    gap: round(gap),
    meanBad: bad.length ? round(mean(bad)) : null,
    meanClean: clean.length ? round(mean(clean)) : null,
    // The distance between the two class means: how far apart the arm pushes
    // the answers, independent of where any cutoff lands.
    separation: bad.length && clean.length ? round(mean(bad) - mean(clean)) : null,
  };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (n: number) => Math.round(n * 1000) / 1000;

type ArmRows = NonNullable<ReturnType<typeof scoreArm>>;
const results: Record<string, { spent: { calls: number; inputTokens: number; usd: number }; rows: ArmRows[] }> = {};
for (const arm of arms) {
  const merged = new Map<string, Labelled & { _n: number; _sum: number }>();
  let spent = { calls: 0, inputTokens: 0, usd: 0 };
  for (let i = 0; i < repeat; i += 1) {
    const r = await run({
      rules,
      paths,
      arm,
      // No cache: an arm comparison that reads another arm's verdicts measures
      // nothing, and repeats that read pass one measure the cache.
      cachePath: null,
      force: true,
      concurrency: 4,
    });
    spent = {
      calls: spent.calls + r.spent.calls,
      inputTokens: spent.inputTokens + r.spent.inputTokens,
      usd: spent.usd + r.spent.usd,
    };
    for (const f of r.all) {
      if (typeof f.value !== "number") continue;
      // Includes the subject text: one line can hold several subjects for one
      // rule, and keying on the line alone averages them together.
      const k = `${f.rule}\u0000${f.file}\u0000${f.line}\u0000${f.text ?? ""}`;
      if (!merged.has(k)) merged.set(k, { ...f, label: "unlabeled", _n: 0, _sum: 0 });
      const e = merged.get(k)!;
      e._n += 1;
      e._sum += f.value!;
      e.value = e._sum / e._n;
    }
    process.stderr.write(
      `arm ${arm} pass ${i + 1}/${repeat}: ${r.stats.subjects} subject(s), ${r.spent.calls} request(s), $${r.spent.usd.toFixed(5)}\n`,
    );
  }
  const all = [...merged.values()];
  results[arm] = {
    spent,
    rows: rules.map((r) => scoreArm(all, r)).filter((r): r is ArmRows => r !== null),
  };
}

// Report: one block per rule, one row per arm, so the comparison that matters
// (this rule, across arms) reads down a column.
const out: string[] = [];
out.push(`state arms compared over ${repeat} pass(es) on ${paths.join(", ")}`);
out.push("");
for (const rule of rules) {
  const rows = arms
    .map((arm) => ({ arm, ...(results[arm]!.rows.find((r) => r?.rule === rule.id) ?? {}) }))
    .filter((r) => "subjects" in r && r.subjects) as Array<{ arm: string } & ArmRows>;
  if (rows.length === 0) continue;
  out.push(`${rule.id}  (${rule.languages.join("/")}, subject: ${rule.subject}, declared arm: ${rule.state})`);
  out.push(
    `  ${"arm".padEnd(9)} ${"prec".padEnd(6)} ${"recall".padEnd(7)} ${"tp/fp/fn".padEnd(10)} ${"sep".padEnd(7)} ${"gap".padEnd(6)} ${"mean bad".padEnd(9)} ${"mean clean".padEnd(10)} separable`,
  );
  for (const r of rows) {
    out.push(
      `  ${r.arm.padEnd(9)} ${String(r.precision ?? "-").padEnd(6)} ${String(r.recall ?? "-").padEnd(7)} ` +
        `${`${r.tp}/${r.fp}/${r.fn}`.padEnd(10)} ${String(r.separation ?? "-").padEnd(7)} ${String(r.gap).padEnd(6)} ` +
        `${String(r.meanBad ?? "-").padEnd(9)} ${String(r.meanClean ?? "-").padEnd(10)} ${r.separable ? "yes" : "no"}`,
    );
  }
  const best = rows
    .filter((r) => r.separable)
    .sort((a, b) => (b.separation ?? 0) - (a.separation ?? 0))[0];
  if (best) out.push(`  -> widest separable margin: ${best.arm}`);
  else out.push(`  -> no arm separates this rule's classes; the question needs rewriting, not an arm`);
  out.push("");
}

out.push("cost:");
for (const arm of arms) {
  out.push(
    `  ${arm.padEnd(9)} ${results[arm]!.spent.calls} request(s), ${results[arm]!.spent.inputTokens.toLocaleString()} input tokens, $${results[arm]!.spent.usd.toFixed(5)}`,
  );
}

process.stdout.write(`${out.join("\n")}\n`);
if (outPath) {
  writeFileSync(outPath, `${JSON.stringify({ repeat, arms, results }, null, 2)}\n`);
  process.stderr.write(`wrote ${outPath}\n`);
}
