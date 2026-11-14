import { strict as assert } from "node:assert";
import { parseScanResult } from "../src/scan-contract.ts";
import { buildScanResult } from "../src/audit.ts";
import { gate } from "../src/gate.ts";
import { subjectOf } from "./builders.ts";
import { test } from "./harness.ts";

function answeredScan() {
  const subject = subjectOf();
  return buildScanResult({ ...gate([{ subject, answer: { kind: "score", value: 0, confidence: 0.9 } }]),
    rules: [subject.rule], subjects: [subject], batches: [], cachedCount: 0, spent: { calls: 1, inputTokens: 1, ms: 0, usd: 0 } },
  { runId: "run-00001", repository: "example/project", sourceSha: "a".repeat(40) });
}

test("scan-contract: malformed process-boundary envelopes cannot become successful scans", () => {
  for (const raw of [null, {}, [], { schema: "jev-lint-scan-1", status: "complete", candidates: [] }]) assert.throws(() => parseScanResult(raw), /scan/);
});

test("scan-contract: visible missing candidates cannot be hidden behind complete coverage counters", () => {
  const subject = subjectOf();
  const result = { ...gate([{ subject, answer: null }]), rules: [subject.rule], subjects: [subject], batches: [], cachedCount: 0,
    spent: { calls: 0, inputTokens: 0, ms: 0, usd: 0 } };
  const scan = buildScanResult(result, { runId: "run-00001", repository: "example/project", sourceSha: "a".repeat(40) });
  const forged = { ...scan, status: "complete", coverage: { ...scan.coverage, missing: 0, answered: 1 } };
  assert.throws(() => parseScanResult(forged), /scan/);
});

test("scan-contract: dispositions agree with the cutoff, including its exact boundary", () => {
  const raw = answeredScan();
  const candidate = raw.candidates[0]!;
  candidate.disposition = "reported";
  assert.throws(() => parseScanResult(raw), /scan/);
  candidate.disposition = "retracted";
  assert.throws(() => parseScanResult(raw), /scan/);
  candidate.judgment!.value = candidate.judgment!.threshold;
  assert.equal(parseScanResult(raw).candidates[0]!.disposition, "retracted");
  candidate.disposition = "reported";
  assert.equal(parseScanResult(raw).candidates[0]!.disposition, "reported");
  candidate.disposition = "below-threshold";
  assert.throws(() => parseScanResult(raw), /scan/);
});

test("scan-contract: source paths are canonical repository-relative names on every host OS", () => {
  for (const path of ["", "../a.ts", "src/../a.ts", "./a.ts", "/a.ts", "C:/a.ts", "C:a.ts", "src\\a.ts", "a//b.ts", "a/", "a\u0000.ts"]) {
    const raw = answeredScan(); raw.candidates[0]!.source.path = path;
    assert.throws(() => parseScanResult(raw), /scan/, path);
  }
  for (const path of ["a.ts", "src/a.ts", "src/日本語.ts", "src/a file.ts", "@abcdef"]) {
    const raw = answeredScan(); raw.candidates[0]!.source.path = path;
    assert.equal(parseScanResult(raw).candidates[0]!.source.path, path);
  }
});
