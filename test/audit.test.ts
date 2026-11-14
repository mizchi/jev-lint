import { strict as assert } from "node:assert";
import { buildScanResult, parseScanResult } from "../src/audit.ts";
import { gate } from "../src/gate.ts";
import { subjectOf, scoreRule } from "./builders.ts";
import type { RunResult } from "../src/types.ts";
import { truncate } from "../src/state.ts";
import { test } from "./harness.ts";

const identity = { runId: "run-00001", repository: "example/project", sourceSha: "a".repeat(40) };
function fixture(missing = false): RunResult {
  const rule = scoreRule();
  const subject = subjectOf({ rule });
  return { ...gate([{ subject, answer: missing ? null : { kind: "score", value: 0.1, confidence: 0.9 } }]),
    rules: [rule], subjects: [subject], batches: [], cachedCount: 0, spent: { calls: 1, inputTokens: 1, usd: 0, ms: 1 } };
}

test("audit: below-threshold candidates retain identity and evidence without becoming findings", () => {
  const run = fixture();
  const scan = buildScanResult(run, identity);
  assert.equal(scan.schema, "jev-lint-scan-1");
  assert.equal(scan.status, "complete");
  assert.equal(scan.candidates.length, 1);
  assert.equal(scan.candidates[0]!.disposition, "below-threshold");
  assert.equal(scan.candidates[0]!.source.path, "a.ts");
  assert.match(scan.candidates[0]!.source.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(scan.candidates[0]!.id, buildScanResult(run, { ...identity, runId: "another-run" }).candidates[0]!.id);
  assert.deepEqual(parseScanResult(JSON.parse(JSON.stringify(scan))), scan);
});

test("audit: missing verdicts, context loss, truncation and dry runs never look complete", () => {
  assert.equal(buildScanResult(fixture(true), identity).status, "failed");
  const run = fixture();
  run.undeclared = ["moonbit"];
  assert.equal(buildScanResult(run, identity).status, "partial");
  run.undeclared = [];
  const limited = buildScanResult(run, identity, { maxCandidates: 0 });
  assert.equal(limited.status, "partial");
  assert.equal(limited.coverage.omittedCandidates, 1);
  assert.equal(buildScanResult({ ...run, dryRun: true }, identity).status, "partial");
});

test("audit: a forged complete result with missing answers or a different source is rejected", () => {
  const scan = buildScanResult(fixture(true), identity);
  assert.throws(() => parseScanResult({ ...scan, status: "complete" }), /scan/);
  assert.throws(() => parseScanResult({ ...scan, sourceSha: "HEAD" }), /scan/);
  assert.throws(() => buildScanResult(fixture(), { ...identity, sourceSha: "HEAD" }), /source/);
});

test("audit: a truncated code subject is partial even without text-block cut metadata", () => {
  const run = fixture();
  const subject = subjectOf({ text: truncate("x".repeat(5000)) });
  const result = { ...run, subjects: [subject], ...gate([{ subject, answer: { kind: "score" as const, value: 0.1, confidence: 0.9 } }]) };
  const report = buildScanResult(result, identity);
  assert.equal(report.status, "partial");
  assert.equal(report.coverage.cutSubjects, 1);
});
