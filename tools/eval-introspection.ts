import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
import { Jev, API_KEY_VARS, fromEnv } from "../src/jev.ts";
import { loadRules, shippedRulesPath } from "../src/rules.ts";
import { prepareIntrospection, introspect, parseIntrospectionReport, introspectionConfig, INTROSPECTION_QUESTION, type IntrospectionReport } from "../src/introspection.ts";
import { relationDigest } from "../src/relation-contract.ts";
import type { ChoiceQuestion } from "../src/types.ts";

interface Case { id: string; rule: string; files: Record<string, string>; git: boolean }
interface Sample { id: string; pass: number; report: IntrospectionReport | null; checks: { selection: boolean; provenance: boolean; configuration: boolean } }
interface Evaluation { schema: string; corpusDigest: string; repeat: number; question: ChoiceQuestion; samples: Sample[]; total: number; gate: string; usage: unknown }
const flags = new Map<string, string>(), args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (!["--out", "--compare", "--replay", "--repeat", "--corpus"].includes(args[i]) || flags.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("invalid introspection evaluation arguments");
  flags.set(args[i], args[++i]);
}
const corpus = resolve(flags.get("--corpus") ?? "experiments/introspection");
const cases: Case[] = JSON.parse(readFileSync(join(corpus, "inputs.json"), "utf8")).cases;
const expected: Array<{ id: string; choice?: string; choices?: Record<string, string> }> = JSON.parse(readFileSync(join(corpus, "expect.json"), "utf8")).cases;
if (!cases.length || cases.length !== expected.length || new Set(cases.map((c) => c.id)).size !== cases.length || cases.some((c) => expected.filter((e) => e.id === c.id).length !== 1)) throw new Error("invalid introspection corpus");
const corpusDigest = relationDigest({ cases, expected });
const saved: Evaluation | null = flags.has("--replay") ? JSON.parse(readFileSync(resolve(flags.get("--replay")!), "utf8")) : null;
const repeat = saved?.repeat ?? Number(flags.get("--repeat") ?? 3);
if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 10 || saved && (saved.corpusDigest !== corpusDigest || flags.has("--repeat") || relationDigest(saved.question) !== relationDigest(INTROSPECTION_QUESTION))) throw new Error("incomparable or stale introspection evaluation");
if (!saved && !fromEnv(API_KEY_VARS)) throw new Error("introspection evaluation requires a model API key");
const client = new Jev({ budget: { maxRequests: 200, maxInputTokens: 400000, maxMs: 300000, maxUsd: 0.03 } });
const catalog = loadRules([shippedRulesPath()!]).rules;
async function evaluate(record: Evaluation | null): Promise<Evaluation> {
  if (record && (record.schema !== "jev-lint-introspection-eval-1" || record.corpusDigest !== corpusDigest || record.repeat !== repeat
    || !Array.isArray(record.samples) || record.samples.length !== cases.length * repeat || new Set(record.samples.map((s) => `${s.id}:${s.pass}`)).size !== record.samples.length)) throw new Error("incomparable introspection evaluation");
  const samples: Sample[] = [];
  for (let pass = 1; pass <= repeat; pass++) for (const item of cases) {
    const cwd = mkdtempSync(join(tmpdir(), "jev-introspection-eval-"));
    try {
      for (const [path, body] of Object.entries(item.files)) { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), body); }
      if (item.git) execFileSync("git", ["init", "-q"], { cwd, stdio: "ignore" });
      const rules = item.rule === "*" ? catalog : catalog.filter((r) => `${r.languageDir}/${r.id}` === item.rule);
      if (!rules.length || item.rule !== "*" && rules.length !== 1) throw new Error(`missing rule: ${item.rule}`);
      const input = prepareIntrospection({ cwd, rules }), oracle = expected.find((e) => e.id === item.id)!;
      const question = record?.question ?? INTROSPECTION_QUESTION;
      let report: IntrospectionReport | null = null;
      const checks = { selection: false, provenance: false, configuration: false };
      try {
        report = record ? record.samples.find((s) => s.id === item.id && s.pass === pass)?.report ?? null : await introspect(input, { client, question });
        const validated = parseIntrospectionReport(report, input, { question }); checks.provenance = true;
        const choices = oracle.choices ?? { [item.rule]: oracle.choice! };
        checks.selection = validated.decisions.length === Object.keys(choices).length && validated.decisions.every((d) => d.judgment?.choice === choices[d.key]);
        const enabled = Object.keys(choices).filter((key) => choices[key] === "enable");
        if (enabled.length) {
          const config = parse(introspectionConfig(validated, input, { question }));
          checks.configuration = validated.status === "complete" && Object.keys(config.rules).length === enabled.length && enabled.every((key) => config.rules[key] === "on") && !("apiKey" in config);
        } else {
          let refused = false; try { introspectionConfig(validated, input, { question }); } catch { refused = true; }
          checks.configuration = refused && validated.coverage.enabled === 0 && validated.coverage.missing === 0;
        }
      } catch { /* An invalid answer fails all affected rubric checks. */ }
      samples.push({ id: item.id, pass, report, checks });
      if (!Object.values(checks).every(Boolean)) process.stdout.write(`${item.id}:${pass} ${JSON.stringify(checks)}\n`);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
  const total = 100 * samples.reduce((n, s) => n + Object.values(s.checks).filter(Boolean).length, 0) / (samples.length * 3);
  return { schema: "jev-lint-introspection-eval-1", corpusDigest, repeat, question: record?.question ?? INTROSPECTION_QUESTION, samples, total, gate: samples.every((s) => Object.values(s.checks).every(Boolean)) ? "pass" : "fail", usage: record?.usage ?? client.spent };
}
const before = flags.has("--compare") ? await evaluate(JSON.parse(readFileSync(resolve(flags.get("--compare")!), "utf8"))) : null;
const report = await evaluate(saved);
const regressions = before?.samples.flatMap((s) => Object.entries(s.checks).filter(([key, ok]) => ok && !report.samples.find((r) => r.id === s.id && r.pass === s.pass)?.checks[key as keyof Sample["checks"]]).map(([key]) => `${s.id}:${s.pass}:${key}`)) ?? [];
const comparison = before ? { delta: report.total - before.total, regressions } : null;
if (!saved || flags.has("--out")) { const target = resolve(flags.get("--out") ?? "experiments/introspection/last.json"); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, JSON.stringify({ ...report, comparison }, null, 2) + "\n"); }
process.stdout.write(JSON.stringify({ total: report.total, gate: report.gate, samples: report.samples.length, comparison }, null, 2) + "\n");
process.exitCode = report.gate === "pass" && !regressions.length ? 0 : 1;
