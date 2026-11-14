import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { ADVERSARIAL_CASES, evaluateAdversarial } from "../src/adversarial.ts";
import { run } from "../src/run.ts";
import { loadRules } from "../src/rules.ts";
import { buildScanResult, type ScanResultV1 } from "../src/audit.ts";
import { Jev, fromEnv, API_KEY_VARS } from "../src/jev.ts";

const args = process.argv.slice(2);
const value = (flag: string, fallback: string) => { const index = args.indexOf(flag); return index < 0 ? fallback : args[index + 1] ?? fallback; };
if (!fromEnv(API_KEY_VARS)) throw new Error("adversarial evaluation needs a model API key; no model accuracy is asserted by offline tests");
const cwd = mkdtempSync(join(tmpdir(), "jev-adversarial-"));
const rules = loadRules(["rules/typescript/fn-name-promises"]).rules;
const runs: ScanResultV1[] = [];
try {
  execFileSync("git", ["init", "-q"], { cwd });
  const report = await evaluateAdversarial({ repeat: Number(value("--repeat", "3")), screen: async (source) => {
    writeFileSync(join(cwd, "input.ts"), source);
    execFileSync("git", ["add", "input.ts"], { cwd });
    execFileSync("git", ["-c", "user.name=Evaluation", "-c", "user.email=eval@example.invalid", "commit", "--allow-empty", "-qm", "Evaluation snapshot"], { cwd });
    const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
    const client = new Jev({ budget: { maxRequests: 4, maxInputTokens: 100_000, maxMs: 60_000 }, onRequest: (body) => {
      if (!body.includes(JSON.stringify(source))) throw new Error("evaluation source did not reach the model request");
    } });
    const result = await run({ cwd, rules, paths: ["input.ts"], cachePath: null, client });
    runs.push(buildScanResult(result, { runId: `sample-${runs.length + 1}`, repository: "evaluation/fixture", sourceSha }));
    const finding = result.all[0];
    return !finding || finding.messageId === "missing" ? null : finding.reported;
  } });
  const output = resolve(value("--out", "experiments/adversarial/last.json"));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({ ...report, corpus: ADVERSARIAL_CASES, runs }, null, 2)}\n`);
  process.stdout.write(`${output}: ${report.inducedMisses} induced miss(es), ${report.inducedFalsePositives} induced false positive(s), ${report.missing} missing; detail evaluation not run\n`);
  process.exitCode = report.status === "complete" ? 0 : 3;
} finally { rmSync(cwd, { recursive: true, force: true }); }
