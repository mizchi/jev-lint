import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Jev, API_KEY_VARS, fromEnv } from "../src/jev.ts";
import { screenRelationWorkflow, parseRelationWorkflow, type RelationWorkflowResult } from "../src/relation-workflow.ts";
import { readSpecSources, type SpecSourceManifest } from "../src/relation-plan.ts";
import { parseRelationReport } from "../src/relation-report.ts";
import { relationDigest, relationPath, type RelationInput, type RelationChoice, type RelationResolution } from "../src/relation-contract.ts";

interface Case { id: string; statement: string; main: string; helpers: Record<string, string>; missingClaim?: boolean; outsideScope?: boolean; context?: { maxAddedChars: number } }
interface Expected { id: string; targetPath: string; choice: RelationChoice | null; resolution: RelationResolution | null; missingClaim: boolean; outsideScope: boolean }
const args = process.argv.slice(2), flags = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  if (!["--out", "--repeat", "--replay", "--watchpoint", "--corpus"].includes(args[i]) || flags.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("invalid workflow evaluation arguments");
  flags.set(args[i], args[++i]);
}
const corpus = resolve(flags.get("--corpus") ?? "experiments/relations/workflow");
const cases: Case[] = JSON.parse(readFileSync(join(corpus, "inputs.json"), "utf8")).cases;
const expected: Expected[] = JSON.parse(readFileSync(join(corpus, "expect.json"), "utf8")).cases;
if (!cases.length || new Set(cases.map((c) => c.id)).size !== cases.length || cases.length !== expected.length || cases.some((c) => expected.filter((e) => e.id === c.id).length !== 1)) throw new Error("invalid workflow evaluation corpus");
const digest = relationDigest({ cases, expected });
const saved = flags.has("--replay") ? JSON.parse(readFileSync(resolve(flags.get("--replay")!), "utf8")) : null;
if (saved && (saved.schema !== "jev-lint-workflow-eval-1" || saved.corpusDigest !== digest || flags.has("--repeat"))) throw new Error("incomparable workflow evaluation");
const repeat = saved?.repeat ?? Number(flags.get("--repeat") ?? 3);
if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 10) throw new Error("invalid repetition count");
const watchpoint = resolve(flags.get("--watchpoint") ?? "../watchpoint");
const { importSemanticRelations } = await import(pathToFileURL(join(watchpoint, "src/quality/semantic-relations.ts")).href);
if (!saved && !fromEnv(API_KEY_VARS)) throw new Error("workflow evaluation requires a model API key");
const client = new Jev({ budget: { maxRequests: 300, maxInputTokens: 450000, maxUsd: 0.03, maxMs: 300000 }, onRequest: (body) => {
  if (body.includes('"expectedChoice"') || body.includes('"outsideScope"') || body.includes('"missingClaim"')) throw new Error("oracle reached model");
} });
const samples: Array<{ id: string; pass: number; workflow: RelationWorkflowResult; checks: Record<string, boolean>; consumer: unknown }> = [];
for (let pass = 1; pass <= repeat; pass++) for (const item of cases) {
  const oracle = expected.find((e) => e.id === item.id)!;
  const cwd = mkdtempSync(join(tmpdir(), "jev-workflow-eval-"));
  try {
    const git = (...argv: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...argv], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_DATE: "2026-11-14T00:00:00Z", GIT_COMMITTER_DATE: "2026-11-14T00:00:00Z" },
    }).trim();
    git("init", "-qb", "main");
    const write = (path: string, text: string) => { if (!relationPath(path)) throw new Error("invalid fixture path"); mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), text); };
    const files = { "docs/contract.md": item.statement, "src/main.ts": item.main, "src/display.ts": 'export function displayLabel(value) { return String(value); }', ...item.helpers };
    for (const [path, text] of Object.entries(files)) write(path, text);
    const commit = () => { git("add", "."); git("-c", "user.name=Evaluation", "-c", "user.email=eval@example.invalid", "commit", "-qm", "Snapshot"); return git("rev-parse", "HEAD"); };
    const base = commit(); write("docs/contract.md", `${item.statement}\n`); const head = commit();
    const manifests: SpecSourceManifest[] = Object.keys(files).map((path, i) => ({ id: path === "docs/contract.md" ? "spec" : path === "src/main.ts" ? "main" : `source-${i}`, path, ref: head,
      kind: path.startsWith("docs/") ? "documentation" : "code", authority: path.startsWith("docs/") ? "approved" : "observed",
      scope: path.startsWith("docs/") ? [item.outsideScope ? "other" : "src"] : [], approval: path.startsWith("docs/") ? { id: "approval-001", revision: 1, digest: "c".repeat(64) } : null }));
    const input: RelationInput = { schema: "jev-lint-relations-input-1", repository: "evaluation/service", sourceSha: head, runId: `workflow-${samples.length + 1}`,
      sources: readSpecSources(cwd, manifests), claims: item.missingClaim ? [] : [{ id: "requirement", statement: item.statement, evidence: [{ sourceId: "spec", startLine: 1, endLine: 1, quote: item.statement }] }], expectedClaimIds: ["requirement"], relations: [] };
    const options = { baseSha: base, changedPaths: ["docs/contract.md"] };
    const workflow: RelationWorkflowResult = saved ? saved.samples.find((s: { id: string; pass: number }) => s.id === item.id && s.pass === pass)?.workflow
      : await screenRelationWorkflow(input, { ...options, client, discovery: { maxCandidatesPerClaim: 1 }, context: item.context });
    const checks: Record<string, boolean> = { retrieval: false, semantic: false, direction: false, provenance: false, coverage: false, consumer: false };
    let consumer: unknown = null;
    try {
      if (!workflow || relationDigest(workflow.rounds[0]?.input.sources) !== relationDigest(input.sources) || workflow.input.runId !== input.runId) throw new Error("invalid workflow record");
      if (saved) await parseRelationWorkflow(workflow, input, { ...options, discovery: { maxCandidatesPerClaim: 1 }, context: item.context });
      for (const round of workflow.rounds) parseRelationReport(round.report, round.input, options);
      parseRelationReport(workflow.report, workflow.input, options); checks.provenance = true;
      const candidate = workflow.report.candidates.find((c) => c.evidence.some((e) => e.role === "target" && e.path === oracle.targetPath));
      const noTarget = oracle.missingClaim || oracle.outsideScope;
      checks.retrieval = noTarget ? !candidate : !!candidate;
      checks.semantic = noTarget ? !candidate : candidate?.judgment?.choice === oracle.choice;
      checks.direction = noTarget ? !candidate : candidate?.resolution === oracle.resolution;
      checks.coverage = noTarget ? workflow.status === "partial" && workflow.report.coverage.unplannedClaims === 1
        : !!candidate && workflow.report.coverage.missing === 0 && (oracle.choice !== "insufficient_context" || workflow.status === "partial");
      const imported = importSemanticRelations(workflow.report, { cwd, repository: input.repository, base, head, input: workflow.input, mode: "enforce" });
      consumer = imported;
      checks.consumer = imported.report.verdict === "UNREVIEWED" && imported.report.status !== "failed"
        && (oracle.resolution !== "implementation" || imported.report.findings.length > 0 && imported.relationEvidence.some((c: { id: string }) => c.id === candidate?.id));
    } catch { /* An invalid record fails the rubric rather than borrowing its saved checks. */ }
    samples.push({ id: item.id, pass, workflow, checks, consumer });
    if (!Object.values(checks).every(Boolean)) process.stdout.write(`${item.id}:${pass} ${JSON.stringify(checks)}\n`);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}
const dimensions = Object.keys(samples[0].checks).map((id) => ({ id, passed: samples.filter((s) => s.checks[id]).length, expected: samples.length }));
const report = { schema: "jev-lint-workflow-eval-1", corpusDigest: digest, repeat, dimensions,
  gate: dimensions.every((d) => d.passed === d.expected) ? "pass" : "fail", total: 100 * dimensions.reduce((sum, d) => sum + d.passed / d.expected, 0) / dimensions.length,
  requestedModel: saved?.requestedModel ?? client.model, usage: saved?.usage ?? client.spent, samples };
const output = resolve(flags.get("--out") ?? join(corpus, "last.json"));
if (!saved || flags.has("--out")) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`); }
process.stdout.write(`${JSON.stringify({ ...report, samples: undefined }, null, 2)}\n`);
process.exitCode = report.gate === "pass" ? 0 : 1;
