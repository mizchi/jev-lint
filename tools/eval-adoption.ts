import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { acceptFindings, compareAcceptedFindings, pruneAcceptedFindings } from "../src/acceptance.ts";
import { reviewScan, reviewRelations } from "../src/review-artifact.ts";
import { artifactSarif } from "../src/sarif.ts";
import { explainScope } from "../src/scope.ts";
import { parseIgnores, isIgnored } from "../src/ignore.ts";
import { digest, type ScanResultV1 } from "../src/scan-contract.ts";
import { normalizeRule } from "../src/rules.ts";
import { main } from "../src/cli/main.ts";
import type { RelationCase, RelationExpectation, RelationEvaluation } from "../src/relation-eval.ts";

interface Case { id: string; kind: string; change?: string; revision?: string | null; scopeId?: string; path?: string; files?: Record<string, string>; paths?: string[]; exclude?: string[]; changedPaths?: string[]; git?: boolean; maxEntries?: number; source?: string }
const args = process.argv.slice(2), flags = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  if (!["--out", "--sarif-out", "--compare"].includes(args[i]) || flags.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("invalid adoption evaluation arguments");
  flags.set(args[i], args[++i]);
}
const input = JSON.parse(readFileSync("experiments/adoption/inputs.json", "utf8")) as { baseScan: ScanResultV1; cases: Case[] };
const expected = JSON.parse(readFileSync("experiments/adoption/expect.json", "utf8")).cases as Array<Record<string, unknown> & { id: string }>;
if (expected.length !== input.cases.length || new Set(input.cases.map((c) => c.id)).size !== input.cases.length || input.cases.some((c) => expected.filter((e) => e.id === c.id).length !== 1)) throw new Error("invalid adoption evaluation corpus");
const scope = { scopeId: "service-contract", modelRevision: "deployment-001" };
const accepted = acceptFindings(reviewScan(input.baseScan, scope));
const samples: Array<{ id: string; rubric: string; passed: boolean; error?: string }> = [];
const sarifRuns: ReturnType<typeof artifactSarif>["runs"] = [];
const evaluate = async (id: string, rubric: string, run: () => void | Promise<void>) => {
  try { await run(); samples.push({ id, rubric, passed: true }); }
  catch (error) { samples.push({ id, rubric, passed: false, error: (error as Error).message.slice(0, 400) }); }
};
function changed(item: Case): ScanResultV1 {
  const scan = structuredClone(input.baseScan), candidate = scan.candidates[0];
  if (item.path) candidate.source.path = item.path;
  switch (item.change) {
    case "line": candidate.source.startLine = candidate.source.endLine = 10; break;
    case "context": candidate.contextHash = "f".repeat(64); break;
    case "policy": scan.policy = { ref: "e".repeat(40), digest: "f".repeat(64) }; break;
    case "cutoff": candidate.judgment!.threshold = 0.8; break;
    case "clean": candidate.judgment!.value = 0.1; candidate.disposition = "below-threshold"; break;
    case "changed-clean": candidate.contextHash = "f".repeat(64); candidate.judgment!.value = 0.1; candidate.disposition = "below-threshold"; break;
    case "duplicate": scan.candidates.push({ ...candidate, id: "0".repeat(64) }); scan.coverage.matched++; scan.coverage.answered++; break;
    case "clean-copy-first": case "clean-copy-last": {
      const clean = structuredClone(candidate); clean.id = "0".repeat(64); clean.disposition = "below-threshold"; clean.judgment!.value = 0.1;
      if (item.change === "clean-copy-first") scan.candidates.unshift(clean); else scan.candidates.push(clean);
      scan.coverage.matched++; scan.coverage.answered++; break;
    }
    case "absent": scan.candidates = []; scan.coverage.matched = scan.coverage.answered = 0; break;
    case "omitted": scan.candidates = []; scan.coverage.omittedCandidates = 1; scan.status = "partial"; break;
    case "partial": scan.status = "partial"; scan.coverage.cutSubjects = 1; break;
    case "missing": scan.status = "failed"; scan.coverage.answered = 0; scan.coverage.missing = 1; candidate.judgment = null; candidate.disposition = "missing"; break;
    case "quote": candidate.evidence = "invented evidence"; break;
    case "false-clean": candidate.disposition = "below-threshold"; break;
    case "false-complete": scan.coverage.cutSubjects = 1; break;
  }
  return scan;
}
for (const item of input.cases) {
  const oracle = expected.find((e) => e.id === item.id)!;
  if (item.kind === "acceptance") {
    const currentScope = { scopeId: item.scopeId ?? scope.scopeId, ...(item.revision === null ? {} : { modelRevision: item.revision ?? scope.modelRevision }) };
    await evaluate(item.id, "classification", () => {
      if (oracle.invalid) { assert.throws(() => compareAcceptedFindings(reviewScan(changed(item), currentScope), accepted)); return; }
      const compared = compareAcceptedFindings(reviewScan(changed(item), currentScope), accepted);
      assert.deepEqual(compared.counts, oracle.counts); assert.equal(compared.exitCode, oracle.exitCode); assert.equal(compared.qualityVerdict, "UNREVIEWED");
    });
    if (!oracle.invalid) {
      await evaluate(item.id, "mutation-safety", () => {
        const review = reviewScan(changed(item), currentScope);
        if (oracle.writable) { acceptFindings(review); assert.equal(pruneAcceptedFindings(accepted, review).entries.reduce((n, e) => n + e.count, 0), oracle.remaining); }
        else { assert.throws(() => acceptFindings(review)); assert.throws(() => pruneAcceptedFindings(accepted, review)); }
      });
      await evaluate(item.id, "cli", async () => {
        const cwd = mkdtempSync(join(tmpdir(), "jev-adoption-cli-"));
        try {
          writeFileSync(join(cwd, "scan.json"), JSON.stringify(changed(item))); writeFileSync(join(cwd, "accepted.json"), JSON.stringify(accepted));
          let output = "";
          const argv = ["baseline", "compare", "--artifact", join(cwd, "scan.json"), "--baseline", join(cwd, "accepted.json"), "--scope-id", currentScope.scopeId,
            ...(currentScope.modelRevision ? ["--model-revision", currentScope.modelRevision] : [])];
          const code = await main(argv, { out: (s) => { output += s; }, log: () => {} });
          assert.equal(code, item.revision === null ? 2 : oracle.exitCode);
          if (item.revision === null) assert.equal(output, ""); else assert.equal(JSON.parse(output).qualityVerdict, "UNREVIEWED");
          assert.equal(JSON.parse(readFileSync(join(cwd, "accepted.json"), "utf8")).entries.length, 1);
        } finally { rmSync(cwd, { recursive: true, force: true }); }
      });
    }
  } else if (item.kind === "scope") await evaluate(item.id, "scope", () => {
    const cwd = mkdtempSync(join(tmpdir(), "jev-adoption-scope-"));
    try {
      for (const [path, text] of Object.entries(item.files!)) { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), text); }
      if (item.git) execFileSync("git", ["init", "-q"], { cwd });
      const { rule } = normalizeRule({ id: "name", language: "TypeScript", rule: { kind: "function_declaration" }, ask: "The name describes behavior." });
      const report = explainScope({ cwd, paths: item.paths ?? ["."], rules: [rule!], exclude: item.exclude, changedPaths: item.changedPaths, maxEntries: item.maxEntries });
      assert.equal(report.counts.eligible, oracle.eligible); if (oracle.status) assert.equal(report.status, oracle.status);
      if (oracle.reason) assert.ok(report.files.some((f) => f.path === (oracle.reason as { path: string }).path && f.reason === (oracle.reason as { reason: string }).reason));
      assert.equal(report.modelRequests, 0); assert.equal(report.qualityVerdict, "UNREVIEWED");
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
  else if (item.kind === "directive") await evaluate(item.id, "directives", () => {
    const parsed = parseIgnores(item.source!);
    assert.equal(isIgnored(parsed, 2, "r") || isIgnored(parsed, 5, "r"), oracle.suppressed);
    assert.equal(parsed.invalidDirectives?.length ?? 0, oracle.warnings);
  });
  else if (item.kind === "sarif") await evaluate(item.id, "sarif", () => {
    const exported = artifactSarif(reviewScan(changed(item), scope)); sarifRuns.push(...exported.runs);
    assert.equal(exported.runs[0].results.length, oracle.results); assert.equal(exported.runs[0].invocations[0].executionSuccessful, oracle.successful);
    if (oracle.uri) assert.equal(exported.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, oracle.uri);
    assert.equal(exported.runs[0].properties.qualityVerdict, "UNREVIEWED");
  });
}
const recordedInputs = JSON.parse(readFileSync("experiments/relations/extended/inputs.json", "utf8")).cases as RelationCase[];
const recordedExpected = JSON.parse(readFileSync("experiments/relations/extended/expect.json", "utf8")).cases as RelationExpectation[];
const recorded = JSON.parse(readFileSync("experiments/relations/extended/iteration-01.json", "utf8")) as RelationEvaluation;
for (const [i, sample] of recorded.samples.entries()) await evaluate(`${sample.id}:${sample.pass}`, "recorded-relations", () => {
  const input = structuredClone(recordedInputs.find((c) => c.id === sample.id)!.input); input.runId = `sample-${i + 1}`;
  const oracle = recordedExpected.find((c) => c.id === sample.id)!;
  const review = reviewRelations(sample.report, input, { scopeId: "recorded-evaluation" });
  const state = ["implementation", "documentation"].includes(oracle.resolution) ? "finding" : oracle.resolution === "none" ? "clean" : "unassessed";
  assert.equal(review.observations[0].state, state);
  const exported = artifactSarif(review); sarifRuns.push(...exported.runs);
  assert.equal(exported.runs[0].results.length, state === "clean" ? 0 : 1);
  assert.equal(exported.runs[0].properties.qualityVerdict, "UNREVIEWED");
});
const corpusDigest = digest({ input, expected, recordedInputs, recordedExpected, recorded });
const dimensions = [...new Set(samples.map((s) => s.rubric))].map((id) => { const applicable = samples.filter((s) => s.rubric === id); return { id, passed: applicable.filter((s) => s.passed).length, expected: applicable.length }; });
const report = { schema: "jev-lint-adoption-eval-1", corpusDigest, modelRequests: 0, dimensions, total: 100 * dimensions.reduce((n, d) => n + d.passed / d.expected, 0) / dimensions.length,
  gate: samples.every((s) => s.passed) ? "pass" : "fail", samples };
let comparison: unknown = null;
if (flags.has("--compare")) {
  const before = JSON.parse(readFileSync(resolve(flags.get("--compare")!), "utf8")) as typeof report;
  if (before.schema !== report.schema || before.corpusDigest !== corpusDigest || before.samples.length !== samples.length) throw new Error("incomparable adoption evaluations");
  const regressions = before.samples.filter((s) => s.passed && !samples.some((now) => now.id === s.id && now.rubric === s.rubric && now.passed)).map((s) => `${s.rubric}:${s.id}`);
  comparison = { delta: report.total - before.total, regressions, accepted: report.gate === "pass" && !regressions.length };
}
const output = resolve(flags.get("--out") ?? "experiments/adoption/last.json");
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify({ ...report, comparison }, null, 2)}\n`);
if (flags.has("--sarif-out")) writeFileSync(resolve(flags.get("--sarif-out")!), `${JSON.stringify({ version: "2.1.0", runs: sarifRuns }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...report, samples: samples.filter((s) => !s.passed), comparison }, null, 2)}\n`);
process.exitCode = report.gate === "pass" ? 0 : 1;
