import { strict as assert } from "node:assert";
import { reviewScan } from "../src/review-artifact.ts";
import { acceptFindings, compareAcceptedFindings, pruneAcceptedFindings, parseAcceptedFindings } from "../src/acceptance.ts";
import { scanArtifact } from "./review-fixtures.ts";
import { test } from "./harness.ts";

const scope = { scopeId: "service-contract", modelRevision: "deployment-001" };
test("acceptance: matching findings are accepted, duplicate copies are new and context changes require review", () => {
  const scan = scanArtifact(), review = reviewScan(scan, scope), baseline = acceptFindings(review);
  assert.equal(compareAcceptedFindings(review, baseline).counts.accepted, 1);
  const moved = structuredClone(scan); moved.candidates[0].source.startLine = 10; moved.candidates[0].source.endLine = 10;
  assert.equal(compareAcceptedFindings(reviewScan(moved, scope), baseline).counts.accepted, 1);
  const duplicate = structuredClone(scan); duplicate.candidates.push({ ...duplicate.candidates[0], id: "e".repeat(64) });
  duplicate.coverage.matched++; duplicate.coverage.answered++;
  const compared = compareAcceptedFindings(reviewScan(duplicate, scope), baseline);
  assert.equal(compared.counts.accepted, 1); assert.equal(compared.counts.new, 1); assert.equal(compared.exitCode, 1);
  const changed = structuredClone(scan); changed.candidates[0].contextHash = "f".repeat(64);
  assert.equal(compareAcceptedFindings(reviewScan(changed, scope), baseline).counts.recheck, 1);
  assert.equal(compareAcceptedFindings(reviewScan(scan, { ...scope, modelRevision: "deployment-002" }), baseline).counts.recheck, 1);
});

test("acceptance: a clean duplicate cannot consume or prune the allowance for a still-reported copy", () => {
  const original = scanArtifact(), baseline = acceptFindings(reviewScan(original, scope));
  const clean = structuredClone(original.candidates[0]); clean.id = "0".repeat(64); clean.disposition = "below-threshold"; clean.judgment!.value = 0.1;
  for (const candidates of [[clean, original.candidates[0]], [original.candidates[0], clean]]) {
    const scan = structuredClone(original); scan.candidates = candidates; scan.coverage.matched = scan.coverage.answered = 2;
    const review = reviewScan(scan, scope), result = compareAcceptedFindings(review, baseline);
    assert.equal(result.counts.accepted, 1); assert.equal(result.counts.resolved, 0); assert.equal(result.exitCode, 0);
    assert.equal(pruneAcceptedFindings(baseline, review).entries[0].count, 1);
  }
});

test("acceptance: missing and unobserved entries cannot be pruned; explicit clean answers can", () => {
  const scan = scanArtifact(), baseline = acceptFindings(reviewScan(scan, scope));
  const absent = structuredClone(scan); absent.candidates = []; absent.coverage.matched = 0; absent.coverage.answered = 0;
  const unobserved = compareAcceptedFindings(reviewScan(absent, scope), baseline);
  assert.equal(unobserved.counts.unassessed, 1);
  assert.equal(pruneAcceptedFindings(baseline, reviewScan(absent, scope)).entries.length, 1);
  const clean = structuredClone(scan); clean.candidates[0].disposition = "below-threshold"; clean.candidates[0].judgment!.value = 0.1;
  assert.equal(compareAcceptedFindings(reviewScan(clean, scope), baseline).counts.resolved, 1);
  assert.equal(pruneAcceptedFindings(baseline, reviewScan(clean, scope)).entries.length, 0);
  const missing = structuredClone(scan); missing.status = "failed"; missing.coverage.answered = 0; missing.coverage.missing = 1;
  missing.candidates[0].disposition = "missing"; missing.candidates[0].judgment = null;
  assert.throws(() => acceptFindings(reviewScan(missing, scope)), /incomplete/);
  assert.throws(() => pruneAcceptedFindings(baseline, reviewScan(missing, scope)), /incomplete/);
  assert.equal(compareAcceptedFindings(reviewScan(missing, scope), baseline).exitCode, 3);
});

test("acceptance: cache data, malformed counts, missing deployment identities and wrong scopes are rejected", () => {
  const review = reviewScan(scanArtifact(), scope), baseline = acceptFindings(review);
  assert.throws(() => parseAcceptedFindings({ schema: "jev-lint-cache-1", entries: [] }));
  assert.throws(() => parseAcceptedFindings({ ...baseline, entries: [{ ...baseline.entries[0], count: -1 }] }));
  assert.throws(() => acceptFindings(reviewScan(scanArtifact(), { scopeId: scope.scopeId })), /revision/);
  assert.throws(() => compareAcceptedFindings(reviewScan(scanArtifact(), { ...scope, scopeId: "other" }), baseline), /scope/);
});
