import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Jev, API_KEY_VARS, fromEnv } from "../src/jev.ts";
import { DOCUMENT_QUESTION, prepareDocuments, scanDocuments, parseDocumentReport, documentExitCode, type DocumentManifest, type DocumentReport } from "../src/documents.ts";
import { relationDigest } from "../src/relation-contract.ts";
import type { ChoiceQuestion } from "../src/types.ts";

interface Case { id: string; topic: string; reference: string; target: string; mode: DocumentManifest["comparisons"][number]["mode"] }
interface Sample { id: string; pass: number; report: DocumentReport | null; checks: { semantic: boolean; integrity: boolean; coverage: boolean } }
interface Evaluation { schema: string; corpusDigest: string; repeat: number; question: ChoiceQuestion; samples: Sample[]; total: number; gate: string; usage: unknown }
const args = process.argv.slice(2), flags = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  if (!["--repeat", "--out", "--compare", "--replay"].includes(args[i]) || flags.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("invalid document evaluation arguments");
  flags.set(args[i], args[++i]);
}
const cases: Case[] = JSON.parse(readFileSync("experiments/documents/inputs.json", "utf8")).cases;
const expected: Array<{ id: string; choice: string }> = JSON.parse(readFileSync("experiments/documents/expect.json", "utf8")).cases;
if (!cases.length || cases.length !== expected.length || new Set(cases.map((c) => c.id)).size !== cases.length || cases.some((c) => expected.filter((e) => e.id === c.id).length !== 1)) throw new Error("invalid document corpus");
const corpusDigest = relationDigest({ cases, expected });
const saved: Evaluation | null = flags.has("--replay") ? JSON.parse(readFileSync(resolve(flags.get("--replay")!), "utf8")) : null;
const repeat = saved?.repeat ?? Number(flags.get("--repeat") ?? 3);
if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 10 || saved && (saved.corpusDigest !== corpusDigest || flags.has("--repeat"))) throw new Error("incomparable document evaluation");
if (saved && relationDigest(saved.question) !== relationDigest(DOCUMENT_QUESTION)) throw new Error("document evaluation question changed; run a new live evaluation");
if (!saved && !fromEnv(API_KEY_VARS)) throw new Error("document evaluation requires a model API key");
const question = saved?.question ?? DOCUMENT_QUESTION;
const client = new Jev({ budget: { maxRequests: 200, maxInputTokens: 400000, maxMs: 300000, maxUsd: 0.03 } });
async function evaluate(record: Evaluation | null): Promise<Evaluation> {
  if (record && (record.schema !== "jev-lint-document-eval-1" || record.corpusDigest !== corpusDigest || record.repeat !== repeat || !Array.isArray(record.samples)
    || record.samples.length !== cases.length * repeat || new Set(record.samples.map((s) => `${s.id}:${s.pass}`)).size !== record.samples.length)) throw new Error("incomparable document evaluation");
  const samples: Sample[] = [];
  for (let pass = 1; pass <= repeat; pass++) for (const item of cases) {
    const cwd = mkdtempSync(join(tmpdir(), "jev-document-eval-"));
    try {
      writeFileSync(join(cwd, "reference.md"), item.reference); writeFileSync(join(cwd, "target.md"), item.target);
      const manifest: DocumentManifest = { schema: "jev-lint-documents-manifest-1", files: { reference: { path: "reference.md", role: "reference" }, target: { path: "target.md", role: "document" } }, comparisons: [{ id: "pair", topic: item.topic, mode: item.mode, reference: { source: "reference" }, target: { source: "target" } }] };
      const input = prepareDocuments(manifest, { cwd }), oracle = expected.find((e) => e.id === item.id)!;
      let report: DocumentReport | null = null;
      const checks = { semantic: false, integrity: false, coverage: false };
      try {
        const usedQuestion = record?.question ?? question;
        report = record ? record.samples.find((s) => s.id === item.id && s.pass === pass)?.report ?? null : await scanDocuments(input, { client, question: usedQuestion });
        const validated = parseDocumentReport(report, input, { question: usedQuestion }); checks.integrity = true;
        checks.semantic = validated.candidates[0].judgment?.choice === oracle.choice;
        const unknown = ["unrelated", "insufficient_context"].includes(oracle.choice);
        checks.coverage = validated.coverage.answered === 1 && validated.coverage.missing === 0
          && validated.status === (unknown ? "partial" : "complete") && documentExitCode(validated) === (oracle.choice === "contradicts" ? 1 : unknown ? 3 : 0);
      } catch { /* A missing or invalid answer stays a failed sample. */ }
      samples.push({ id: item.id, pass, report, checks });
      if (!Object.values(checks).every(Boolean)) process.stdout.write(`${item.id}:${pass} ${JSON.stringify(checks)}\n`);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
  const total = 100 * samples.reduce((n, s) => n + Object.values(s.checks).filter(Boolean).length, 0) / (samples.length * 3);
  return { schema: "jev-lint-document-eval-1", corpusDigest, repeat, question: record?.question ?? question, samples, total,
    gate: samples.every((s) => Object.values(s.checks).every(Boolean)) ? "pass" : "fail", usage: record?.usage ?? client.spent };
}
const before: Evaluation | null = flags.has("--compare") ? await evaluate(JSON.parse(readFileSync(resolve(flags.get("--compare")!), "utf8"))) : null;
const report = await evaluate(saved);
const regressions = before?.samples.flatMap((old) => Object.entries(old.checks).filter(([key, value]) => value && !report.samples.find((s) => s.id === old.id && s.pass === old.pass)?.checks[key as keyof Sample["checks"]]).map(([key]) => `${old.id}:${old.pass}:${key}`)) ?? [];
const comparison = before ? { delta: report.total - before.total, regressions, accepted: report.gate === "pass" && !regressions.length } : null;
const output = resolve(flags.get("--out") ?? "experiments/documents/last.json");
if (!saved || flags.has("--out")) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify({ ...report, comparison }, null, 2)}\n`); }
process.stdout.write(`${JSON.stringify({ total: report.total, gate: report.gate, samples: report.samples.length, comparison }, null, 2)}\n`);
process.exitCode = report.gate === "pass" && !regressions.length ? 0 : 1;
