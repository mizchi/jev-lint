#!/usr/bin/env node
/** Evaluate Clef with the shipped questions, preserving accepted Jev baselines. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Clef, CLEF_MODELS, CLEF_MAX_QUESTIONS, CLEF_USD_PER_MTOK } from "../src/clef.ts";
import type { ClefModel } from "../src/clef.ts";
import { loadConfig } from "../src/config.ts";
import { discoverEvals, loadSuite, readEvalRecord, runEval } from "../src/evals.ts";
import type { EvalRecord, EvalSuite } from "../src/evals.ts";
import { Jev, API_KEY_VARS, fromEnv, USD_PER_MTOK } from "../src/jev.ts";
import { compareModels, planModelEval, planModelRequests } from "../src/model-eval.ts";
import type { ModelComparison, ModelScore } from "../src/model-eval.ts";
import { SHIPPED_CUSTOM_LANGUAGES } from "../src/types.ts";

const log = (s: string) => process.stderr.write(`${s}\n`);

function options(args: string[]) {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  const booleans = ["dry-run", "replay", "live-jev", "json", "help"];
  const valued = ["rules", "models", "repeat", "concurrency", "out", "config"];
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (!args[i].startsWith("--") || ![...booleans, ...valued].includes(key)) throw new Error(`unknown option: ${args[i]}`);
    if (booleans.includes(key)) flags.add(key);
    else {
      if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`--${key} needs a value`);
      values[key] = args[++i];
    }
  }
  const positive = (key: string, fallback: number) => {
    const n = Number(values[key] ?? fallback);
    if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`--${key} must be a positive integer`);
    return n;
  };
  const models = [...new Set((values.models ?? CLEF_MODELS.join(",")).split(","))];
  if (!models.length || models.some(m => !CLEF_MODELS.includes(m as ClefModel))) throw new Error("--models must contain clef and/or clef-flash");
  if (flags.has("dry-run") && flags.has("replay")) throw new Error("choose --dry-run or --replay");
  return { roots: (values.rules ?? "rules").split(","), explicitRoots: "rules" in values,
    models: models as ClefModel[], explicitModels: "models" in values, repeat: positive("repeat", 3), concurrency: positive("concurrency", 4),
    out: values.out ?? "experiments/clef", config: values.config ?? null,
    dryRun: flags.has("dry-run"), replay: flags.has("replay"), liveJev: flags.has("live-jev"),
    json: flags.has("json"), help: flags.has("help"),
  };
}

function save(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function recordPath(out: string, model: string, suite: EvalSuite): string {
  return join(out, "records", model, `${suite.name}.json`);
}

function requiredRecord(path: string, suite: EvalSuite): EvalRecord {
  const record = readEvalRecord(path, suite);
  if (!record) throw new Error(`missing or invalid record: ${path}`);
  return record;
}

const fmt = (n: number | null) => n === null ? "-" : n.toFixed(3);

function markdown(comparisons: ModelComparison[], source: string, skipped: string[], errors: string[]): string {
  const lines = ["# Clef evaluation", "", `Jev source: ${source}.`, "",
    "Accuracy uses subjects answered on every pass by both models, at the current shipped cutoffs. Missing answers make the comparison incomplete.", "",
    "The refit uses these same fixtures; it diagnoses threshold shifts and is not held-out accuracy. Historical Jev timings are not a controlled latency comparison.", "",
    "| Suite | Model | Passes | Paired | P | R | F1 | FP | FN | Flips | Missing | USD | Wall ms | Refit F1 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const c of comparisons) {
    for (const [name, s] of [["jev", c.baseline], [c.candidate.model ?? "no model answered", c.candidate]] as Array<[string, ModelScore]>) {
      lines.push(`| ${c.suite} | ${name} | ${s.passes} | ${c.pairedSubjects}/${c.expectedSubjects} | ${fmt(s.shipped.precision)} | ${fmt(s.shipped.recall)} | ${fmt(s.shipped.f1)} | ${s.shipped.fp} | ${s.shipped.fn} | ${s.shipped.flips} | ${s.missingAnswers} | ${s.spent.usd.toFixed(6)} | ${s.spent.ms} | ${fmt(s.refitted.f1)} |`);
    }
    lines.push("");
  }
  lines.push("", "## Changed decisions", "");
  for (const c of comparisons) {
    lines.push(`${c.suite} / ${c.candidate.model ?? "unanswered"}: ${c.regressions.length} regressions, ${c.improvements.length} improvements; ${c.complete ? "complete" : "incomplete"}.`, "");
    for (const d of c.disagreements) lines.push(`- ${d.file}:${d.line} (${d.rule}): Jev ${fmt(d.baseline)}, candidate ${fmt(d.candidate)}.`);
    if (c.disagreements.length) lines.push("");
  }
  if (skipped.length) lines.push("## Skipped suites", "", ...skipped.map(s => `- ${s}`), "");
  if (errors.length) lines.push("## Errors", "", ...errors.map(s => `- ${s}`), "");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<number> {
  const opts = options(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write("Usage: pnpm eval:clef [--dry-run | --replay] [--live-jev] [--rules dir,...]\n  [--models clef,clef-flash] [--repeat 3] [--concurrency 4] [--out experiments/clef]\n  [--config .jev-lint.yaml] [--json]\n");
    return 0;
  }
  let manifest: { baselineSource?: string; suites?: string[]; models?: ClefModel[]; skipped?: string[] } = {};
  if (opts.replay) {
    try {
      const saved = JSON.parse(readFileSync(join(opts.out, "manifest.json"), "utf8"));
      if (typeof saved.baselineSource === "string") manifest.baselineSource = saved.baselineSource;
      if (Array.isArray(saved.suites) && saved.suites.every((s: unknown) => typeof s === "string")) manifest.suites = saved.suites;
      if (Array.isArray(saved.skipped) && saved.skipped.every((s: unknown) => typeof s === "string")) manifest.skipped = saved.skipped;
      if (Array.isArray(saved.models) && saved.models.length && saved.models.every((m: unknown) => CLEF_MODELS.includes(m as ClefModel))) manifest.models = saved.models;
    } catch { /* Older exports can be replayed with explicit suite and model options. */ }
    if (!opts.explicitModels && manifest.models) opts.models = manifest.models;
  }
  const loaded = loadConfig(opts.config);
  if (loaded.errors.length) throw new Error(loaded.errors.join("\n"));
  const languages = loaded.config.languages ?? {};
  const selection = opts.replay && !opts.explicitRoots ? manifest.suites : undefined;
  const found = discoverEvals(opts.roots).filter(s => !selection || selection.includes(s.name));
  if (!found.length) throw new Error(`no eval suites under ${opts.roots.join(", ")}`);
  if (selection?.some(name => !found.some(s => s.name === name))) throw new Error("a recorded eval suite is no longer available");
  const skipped: string[] = selection ? manifest.skipped ?? [] : [];
  const suites = found.filter(suite => {
    const { rules, errors } = loadSuite(suite, languages);
    if (errors.length || !rules.length) throw new Error(`${suite.name}: ${errors.join("; ") || "no rules"}`);
    const unavailable = rules.flatMap(r => r.languages).filter(l => l in SHIPPED_CUSTOM_LANGUAGES && !languages[l]);
    if (!unavailable.length || (opts.replay && (opts.explicitRoots || selection))) return true;
    const message = `${suite.name}: configure a parser for ${[...new Set(unavailable)].join(", ")} with --config`;
    if (opts.explicitRoots) throw new Error(message);
    skipped.push(message);
    return false;
  });
  if (!suites.length) throw new Error("no supported suites to evaluate");
  for (const s of skipped) log(s);

  if (opts.dryRun) {
    const plans = [];
    for (const suite of suites) {
      const plan = await planModelEval(suite, opts.repeat, languages);
      const models: Record<string, { requests: number; tokens: number; usd: number }> = {};
      for (const model of [...(opts.liveJev ? ["jev"] : []), ...opts.models]) {
        const requests = planModelRequests(plan.batches, opts.repeat, model === "jev" ? Infinity : CLEF_MAX_QUESTIONS);
        models[model] = { ...requests, usd: requests.tokens / 1_000_000 * (model === "jev" ? USD_PER_MTOK : CLEF_USD_PER_MTOK[model as ClefModel]) };
      }
      plans.push({ suite: suite.name, subjects: plan.subjects, models });
    }
    const plan = { schema: "jev-lint-model-plan-1", repeat: opts.repeat, suites: plans, skipped,
      note: "Token estimates use the existing Jev estimator, not Clef's tokenizer. Pricing includes repeated state when splitting at 64 questions." };
    process.stdout.write(opts.json ? `${JSON.stringify(plan, null, 2)}\n` : plans.map(p =>
      `${p.suite}: ${p.subjects} subjects; ${Object.entries(p.models).map(([m, v]) => `${m}: ${v.requests} requests, ~${v.tokens} tokens, ~$${v.usd.toFixed(5)}`).join("; ")}`,
    ).join("\n") + `\n${plan.note}\n`);
    return 0;
  }

  // Validate every saved baseline before spending on any candidate.
  const baselines = new Map<string, EvalRecord>();
  for (const suite of suites) {
    if (opts.replay || !opts.liveJev) {
      const record = requiredRecord(opts.replay ? recordPath(opts.out, "jev", suite) : suite.baseline, suite);
      const { rules, labels } = loadSuite(suite, languages);
      compareModels(record, record, labels, rules);
      baselines.set(suite.name, record);
    }
  }
  if (!opts.replay) {
    if (!fromEnv(["CLOUDFLARE_ACCOUNT_ID"]) || !fromEnv(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AUTH_TOKEN"])) {
      throw new Error("set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (or CLOUDFLARE_AUTH_TOKEN); --dry-run needs no credentials");
    }
    if (opts.liveJev && !fromEnv(API_KEY_VARS)) throw new Error("--live-jev needs TYPESAFE_API_KEY or TYPESAFEAI_API_KEY");
  }
  let baselineSource = opts.liveJev ? "live" : "historical accepted baselines";
  if (opts.replay) {
    baselineSource = manifest.baselineSource ?? "saved records (provenance unavailable)";
  } else {
    save(join(opts.out, "manifest.json"), { schema: "jev-lint-model-run-1", recorded: new Date().toISOString(), baselineSource,
      repeat: opts.repeat, models: opts.models, suites: suites.map(s => s.name), skipped });
  }
  const comparisons: Array<ModelComparison & { requestedModel: ClefModel }> = [];
  const errors: string[] = [];
  let stopped = false;
  for (const [index, suite] of suites.entries()) {
    const { rules, labels } = loadSuite(suite, languages);
    try {
      let baseline = baselines.get(suite.name);
      const candidates = new Map<string, EvalRecord>();
      // Rotate provider order between suites when taking fresh Jev samples.
      const order = [...(opts.liveJev && !opts.replay ? ["jev"] : []), ...opts.models];
      const rotated = [...order.slice(index % order.length), ...order.slice(0, index % order.length)];
      for (const model of rotated) {
        const path = recordPath(opts.out, model, suite);
        if (!opts.replay) mkdirSync(dirname(path), { recursive: true });
        const record = opts.replay ? requiredRecord(path, suite) : await runEval({ ...suite, last: path }, {
          repeat: opts.repeat, concurrency: opts.concurrency, languages,
          client: model === "jev" ? new Jev() : new Clef({ model: model as ClefModel }), log,
        });
        if (model === "jev") baseline = record;
        else candidates.set(model, record);
        if (!opts.replay && !record.passes.flat().some(a => typeof a.value === "number" && Number.isFinite(a.value))) {
          log(`${suite.name}/${model}: no usable answers; remaining inference stopped`);
          stopped = true;
          break;
        }
      }
      if (!baseline) throw new Error(`${suite.name}: missing Jev record`);
      if (!opts.replay) save(recordPath(opts.out, "jev", suite), baseline);
      for (const model of opts.models) {
        const record = candidates.get(model);
        if (record) comparisons.push({ ...compareModels(baseline, record, labels, rules), requestedModel: model });
      }
    } catch (err: unknown) {
      const message = `${suite.name}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(message);
      log(message);
    }
    if (stopped) break;
  }
  const report = { schema: "jev-lint-model-comparison-1", recorded: new Date().toISOString(), baselineSource,
    complete: errors.length === 0 && comparisons.length === suites.length * opts.models.length && comparisons.every(c => c.complete),
    stopped, skipped, errors, comparisons };
  save(join(opts.out, "report.json"), report);
  const md = markdown(comparisons, baselineSource, skipped, errors);
  writeFileSync(join(opts.out, "report.md"), md);
  process.stdout.write(opts.json ? `${JSON.stringify(report, null, 2)}\n` : md);
  return errors.length ? 2 : report.complete ? 0 : 3;
}

try { process.exitCode = await main(); }
catch (err: unknown) { log(err instanceof Error ? err.message : String(err)); process.exitCode = 2; }
