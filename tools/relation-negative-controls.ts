import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parseRelationInput, type RelationJudgment } from "../src/relation-contract.ts";
import { replayRelationEvaluation, type RelationCase, type RelationExpectation, type RelationEvaluation } from "../src/relation-eval.ts";

interface ContractControl {
  id: string; broken: string; control: string; exportName: string; failedTests: string[];
  tests: Array<{ id: string; args: unknown[]; expected: unknown }>;
}
interface GateControl { id: string; caseId: string; mutation: string; failedChecks: string[]; missing: number }
interface ControlManifest { schema: "jev-lint-relation-negative-controls-1"; contractCorpus?: string; contracts: ContractControl[]; gates: GateControl[] }
interface ControlCheck { id: string; status: "pass" | "assertion" | "execution"; actual?: unknown; expected?: unknown }
interface ContractRun { exitCode: number | null; checks: ControlCheck[]; error: string | null }
export interface NegativeFixtures {
  root: string; cases: RelationCase[]; contractCases: RelationCase[]; expected: RelationExpectation[]; baseline: RelationEvaluation; controls: ControlManifest;
}
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const childEnv = { NO_COLOR: "1", NODE_NO_WARNINGS: "1" };

export function loadNegativeControls(root = ROOT): NegativeFixtures {
  const read = (file: string) => JSON.parse(readFileSync(join(root, "experiments/relations", file), "utf8"));
  const controls = read("negative-controls.json") as ControlManifest;
  if (controls.schema !== "jev-lint-relation-negative-controls-1" || !Array.isArray(controls.contracts) || !controls.contracts.length
    || !Array.isArray(controls.gates) || !controls.gates.length
    || new Set(controls.contracts.map((control) => control.id)).size !== controls.contracts.length
    || new Set(controls.contracts.map((control) => control.broken)).size !== controls.contracts.length
    || new Set(controls.gates.map((control) => control.id)).size !== controls.gates.length
    || new Set(controls.gates.map((control) => JSON.stringify([control.caseId, control.mutation]))).size !== controls.gates.length) throw new Error("invalid negative control manifest");
  return { root, cases: read("inputs.json").cases, contractCases: read(controls.contractCorpus ?? "inputs.json").cases,
    expected: read("expect.json").cases, baseline: read("v3-iteration-01.json"), controls };
}

function executeContract(input: RelationCase["input"], control: ContractControl): ContractRun {
  parseRelationInput(input);
  const target = input.relations[0].targets[0], source = input.sources.find((s) => s.id === target.sourceId)!;
  if (source.kind !== "code") throw new Error("negative control needs a trusted code fixture");
  const directory = mkdtempSync(join(tmpdir(), "jev-negative-contract-"));
  try {
    // These are repository-owned synthetic fixtures, never generated patches or customer code.
    writeFileSync(join(directory, "subject.mts"), source.content);
    writeFileSync(join(directory, "oracle.mjs"), `import assert from "node:assert/strict";
import { ${control.exportName} as target } from "./subject.mts";
const results = [];
for (const vector of ${JSON.stringify(control.tests)}) {
  let actual;
  try { actual = target(...vector.args); }
  catch { results.push({ id: vector.id, status: "execution" }); continue; }
  try { assert.deepStrictEqual(actual, vector.expected); results.push({ id: vector.id, status: "pass" }); }
  catch { results.push({ id: vector.id, status: "assertion", actual, expected: vector.expected }); }
}
process.stdout.write(JSON.stringify(results));
process.exitCode = results.every(result => result.status === "pass") ? 0 : 1;
`);
    const result = spawnSync(process.execPath, ["--experimental-strip-types", join(directory, "oracle.mjs")],
      { encoding: "utf8", env: childEnv, timeout: 5000, maxBuffer: 1024 * 1024 });
    if (result.error || result.signal || result.stderr) return { exitCode: result.status, checks: [], error: "compile-or-execution-error" };
    try { return { exitCode: result.status, checks: JSON.parse(result.stdout), error: null }; }
    catch { return { exitCode: result.status, checks: [], error: "missing-contract-results" }; }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export function checkContractControl(cases: RelationCase[], control: ContractControl) {
  if (!/^[A-Za-z_$][\w$]*$/.test(control.exportName) || !control.tests.length || !control.failedTests.length
    || new Set(control.tests.map((test) => test.id)).size !== control.tests.length
    || new Set(control.failedTests).size !== control.failedTests.length
    || control.failedTests.some((id) => !control.tests.some((test) => test.id === id))) throw new Error("invalid negative control assertions");
  const broken = cases.find((item) => item.id === control.broken), clean = cases.find((item) => item.id === control.control);
  if (!broken || !clean) throw new Error("missing negative control fixture");
  const red = executeContract(broken.input, control), green = executeContract(clean.input, control);
  const ids = control.tests.map((test) => test.id);
  const passed = red.error === null && green.error === null && red.exitCode === 1 && green.exitCode === 0
    && isDeepStrictEqual(red.checks.map((check) => check.id), ids) && isDeepStrictEqual(green.checks.map((check) => check.id), ids)
    && isDeepStrictEqual(red.checks.filter((check) => check.status === "assertion").map((check) => check.id), control.failedTests)
    && red.checks.every((check) => check.status === "pass" || check.status === "assertion") && green.checks.every((check) => check.status === "pass");
  return { id: control.id, passed, red, green };
}

function mutateReport(fixture: NegativeFixtures, control: GateControl): RelationEvaluation {
  const raw = structuredClone(fixture.baseline), sample = raw.samples.find((item) => item.id === control.caseId && item.pass === 1);
  if (!sample?.report || !/^[\w-]+$/.test(control.id)) throw new Error("invalid negative gate control");
  const candidate = sample.report.candidates[0];
  const judgment = (choice: "supports" | "contradicts"): RelationJudgment => ({ choice, confidence: 1,
    probabilities: { supports: 0, contradicts: 0, unrelated: 0, insufficient_context: 0, [choice]: 1 } });
  switch (control.mutation) {
    case "miss-defect": candidate.judgment = judgment("supports"); candidate.resolution = "none"; break;
    case "false-positive": candidate.judgment = judgment("contradicts"); candidate.resolution = "implementation"; break;
    case "wrong-target": candidate.resolution = "implementation"; break;
    case "fabricate-quote": candidate.evidence[0].quote = "This invented requirement is not present in the source."; break;
    case "missing-answer": candidate.judgment = null; break;
    case "missing-grounding": candidate.claimJudgment = null; break;
    case "delete-grounding": delete (candidate as Partial<typeof candidate>).claimJudgment; break;
    case "omit-sample": raw.samples = raw.samples.filter((item) => item !== sample); break;
    case "stale-head": sample.report.sourceSha = "f".repeat(40); break;
    case "spec-ref": candidate.evidence[0].ref = "f".repeat(40); break;
    case "target-ref": candidate.evidence[1].ref = "f".repeat(40); break;
    case "evidence-path": candidate.evidence[0].path = "docs/another.md"; break;
    case "evidence-hash": candidate.evidence[0].contentHash = "f".repeat(64); break;
    case "evidence-range": candidate.evidence[0].startLine = candidate.evidence[0].endLine = 20; break;
    case "evidence-role": candidate.evidence[0].role = "context"; break;
    case "remove-spec-citation": candidate.evidence = candidate.evidence.filter((e) => e.role !== "specification"); break;
    case "claim-id": candidate.claimId = "not-present"; break;
    case "relation-id": candidate.relationId = "not-present"; break;
    case "repository": sample.report.repository = "another/service"; break;
    case "run-id": sample.report.runId = "another-run"; break;
    case "input-digest": sample.report.inputDigest = "f".repeat(64); break;
    case "candidate-id": candidate.id = "f".repeat(64); break;
    case "context-hash": candidate.contextHash = "f".repeat(64); break;
    case "prompt-revision": sample.report.engine.promptRevision = "f".repeat(64); break;
    case "remove-ledger": sample.report.ledger = []; break;
    case "ledger-evaluated-id": sample.report.ledger[0].evaluatedRelationIds = ["not-present"]; break;
    case "coverage-missing": sample.report.coverage.missing = 1; break;
    case "coverage-ungrounded": sample.report.coverage.ungroundedRelations = 0; break;
    case "plan-selected": sample.report.plan.selected = []; break;
    case "plan-excluded": sample.report.plan.excluded = [{ relationId: candidate.relationId, reason: "outside-change" }]; break;
    case "negative-usage": sample.report.usage.inputTokens = -1; break;
    case "negative-probability": candidate.judgment!.probabilities.contradicts = -0.1; break;
    default: throw new Error("unknown negative gate control");
  }
  // Saved scores/checks deliberately remain untouched: replay must derive the failure itself.
  return raw;
}

export async function checkGateControls(fixture: NegativeFixtures) {
  const pristine = await replayRelationEvaluation(fixture.cases, fixture.expected, fixture.baseline);
  if (pristine.gate !== "pass") throw new Error("negative controls require a passing pristine evaluation");
  const directory = mkdtempSync(join(tmpdir(), "jev-negative-gates-"));
  try {
    const results = [];
    for (const control of fixture.controls.gates) {
      const raw = mutateReport(fixture, control);
      const replay = await replayRelationEvaluation(fixture.cases, fixture.expected, raw);
      const sample = replay.samples.find((item) => item.id === control.caseId && item.pass === 1)!;
      const failedChecks = Object.entries(sample.checks).filter(([, passed]) => !passed).map(([key]) => key).sort();
      const file = join(directory, `${control.id}.json`);
      writeFileSync(file, `${JSON.stringify(raw)}\n`);
      // No credentials, NODE_OPTIONS or nested test-runner context cross into the child.
      const child = spawnSync(process.execPath, [join(fixture.root, "tools/eval-relations.ts"), "--replay", file],
        { cwd: fixture.root, encoding: "utf8", env: childEnv, timeout: 10000, maxBuffer: 1024 * 1024 });
      const passed = replay.gate === "fail" && replay.samples.length === pristine.samples.length && replay.missing === control.missing
        && isDeepStrictEqual(failedChecks, [...control.failedChecks].sort()) && !child.error && !child.signal && child.status === 1
        && child.stderr === "" && child.stdout.includes("gate fail") && child.stdout.includes(`${control.caseId}:1 `);
      results.push({ id: control.id, passed, gate: replay.gate, missing: replay.missing, failedChecks, exitCode: child.status,
        stdout: child.stdout.replaceAll(fixture.root, "<repository>"), stderr: child.stderr.replaceAll(fixture.root, "<repository>") });
    }
    return { pristine: { gate: pristine.gate, total: pristine.total, samples: pristine.samples.length }, results };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
