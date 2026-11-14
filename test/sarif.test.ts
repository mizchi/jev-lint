import { strict as assert } from "node:assert";
import { reviewScan } from "../src/review-artifact.ts";
import { artifactSarif, formatSarif } from "../src/sarif.ts";
import { decide } from "../src/gate.ts";
import { noulRule, subjectOf } from "./builders.ts";
import { scanArtifact } from "./review-fixtures.ts";
import { test } from "./harness.ts";

test("sarif: source locations are encoded and partial scans never advertise successful execution", () => {
  const scan = scanArtifact(); scan.candidates[0].source.path = "src/a #1.ts";
  const sarif = artifactSarif(reviewScan(scan, { scopeId: "local" }));
  assert.equal(sarif.version, "2.1.0"); assert.equal(sarif.runs[0].results.length, 1);
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, "src/a%20%231.ts");
  assert.equal(sarif.runs[0].properties.qualityVerdict, "UNREVIEWED");
  scan.status = "partial"; scan.coverage.omittedCandidates = 1; scan.coverage.matched++; scan.coverage.answered++;
  assert.equal(artifactSarif(reviewScan(scan, { scopeId: "local" })).runs[0].invocations[0].executionSuccessful, false);
});

test("sarif: commit subjects are not misrepresented as physical source files in replay output", () => {
  const finding = decide(subjectOf({ rule: noulRule(), file: "src/a.ts" }), { kind: "noul", value: 0.9, confidence: null });
  const result = { findings: [finding], all: [finding], review: [], stats: { subjects: 1, reported: 1, missing: 0, unsure: 0, review: 0, byRule: {}, byFile: {} } };
  assert.equal(JSON.parse(formatSarif(result)).runs[0].results.length, 1);
  finding.commit = { subject: "Change" };
  assert.throws(() => formatSarif(result), /commit subjects/);
});
