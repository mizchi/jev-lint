import { strict as assert } from "node:assert";
import { buildViewerModel, toCalibrationLabels } from "../src/viewer.ts";
import { test } from "./harness.ts";

const base = {
  repo: "mizchi/example",
  revision: "abc123",
  record: {
    rules: [
      { id: "fn-name-promises", languageDir: "typescript", ask: "The name misleads.", at: 0.6, severity: "warning" },
      { id: "catch-hides-failure", languageDir: "typescript", ask: "The catch hides a failure.", at: 0.7, severity: "info" },
    ],
    answers: [
      { rule: "fn-name-promises", ruleKey: "typescript/fn-name-promises", file: "src/example.ts", line: 10, endLine: 20, kind: "noul", value: 0.83, confidence: null, arm: "located" },
      { rule: "catch-hides-failure", ruleKey: "typescript/catch-hides-failure", file: "src/example.ts", line: 15, endLine: 18, kind: "noul", value: 0.68, confidence: null, arm: "local" },
      { rule: "fn-name-promises", ruleKey: "typescript/fn-name-promises", file: "src/large.ts", line: 1, endLine: 500, kind: null, value: null, confidence: null, arm: null },
    ],
  },
  result: {
    findings: [{ rule: "fn-name-promises", file: "src/example.ts", line: 10, endLine: 20, kind: "noul", value: 0.83, cutoff: 0.6, severity: "warning", message: "The name misleads." }],
    stats: { subjects: 3, missing: 1, byFile: { "src/example.ts": { findings: 1, subjects: 2 }, "src/large.ts": { findings: 0, subjects: 1 } } },
    unpaired: { subjects: 1, files: ["src/large.ts"] },
    degraded: [],
  },
  supplements: [{
    answers: [{ rule: "fn-name-promises", ruleKey: "typescript/fn-name-promises", file: "src/large.ts", line: 1, endLine: 500, kind: "noul", value: 0.2, confidence: null, arm: "graph" }],
  }],
};

test("viewer: keeps findings and clean answers, and fills missing answers from a focused run", () => {
  const model = buildViewerModel([base]);
  assert.equal(model.length, 1);
  assert.deepEqual(model[0]!.summary, { subjects: 3, findings: 1, missing: 0, unpaired: 1, degraded: 0 });
  assert.equal(model[0]!.rows.length, 3);
  assert.deepEqual(model[0]!.rows.map((r) => [r.ruleKey, r.value, r.reported, r.nearCutoff]), [
    ["typescript/fn-name-promises", 0.83, true, false],
    ["typescript/catch-hides-failure", 0.68, false, true],
    ["typescript/fn-name-promises", 0.2, false, false],
  ]);
  assert.equal(model[0]!.files[0]!.path, "src/example.ts");
  assert.equal(model[0]!.files[0]!.findings, 1);
  assert.equal(model[0]!.files[0]!.nearCutoff, 1);
  assert.equal(model[0]!.files[1]!.unpaired, true);
});

test("viewer: exports one repository's explicit decisions in the native calibration format", () => {
  const dataset = buildViewerModel([base])[0]!;
  const decisions = {
    [dataset.rows[0]!.key]: "defect",
    [dataset.rows[1]!.key]: "clean",
    [dataset.rows[2]!.key]: "unsure",
  };
  assert.deepEqual(toCalibrationLabels(dataset, decisions), {
    $default: "unlabeled",
    $note: "mizchi/example@abc123; exported from the review TUI",
    "src/example.ts": [
      { line: 10, rule: "typescript/fn-name-promises", label: "bad", window: 0 },
      { line: 15, rule: "typescript/catch-hides-failure", label: "clean", window: 0 },
    ],
  });
});
