import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "./harness.ts";
import { scoreCatalog, type CatalogCase } from "../packages/pipeline/catalog-eval.ts";

const cases: CatalogCase[] = [
  { id: "stale", pattern: "conflict", catalog: "hardware", description: "download", expected: "software" },
  { id: "absent", pattern: "missing", catalog: "abstain", description: "device", expected: "hardware" },
  { id: "wrong", pattern: "shared-error", catalog: "hardware", description: "device", expected: "software" },
];
const answers = {
  stale: { label: "software", tokens: 11, ms: 8 },
  absent: { label: "hardware", tokens: 7, ms: 5 },
  wrong: { label: "hardware", tokens: 13, ms: 9 },
} as const;

test("catalog eval: on-demand routes charge only requested text and count shared mistakes", () => {
  const result = scoreCatalog(cases, answers);
  assert.deepEqual(result.fallback.summary, {
    cases: 3, auto: 3, reviews: 0, wrong: 2, coverage: 1, autoAccuracy: 1/3,
    calls: 1, inputTokens: 7, serviceMs: 5,
  });
  assert.equal(result.consensus.summary.calls, 2);
  assert.equal(result.consensus.summary.wrong, 1);
  assert.equal(result.consensus.summary.reviews, 2);
  assert.equal(result.consensus.patterns.missing.autoAccuracy, null);
  assert.equal(result.catalog.summary.calls, 0);
  assert.equal(result.text.summary.wrong, 1);
});

test("catalog eval: an empty description abstains for free and a missing recording fails", () => {
  const missing = { ...cases[0], description: "", expected: "review" as const };
  const result = scoreCatalog([missing], {});
  assert.equal(result.text.summary.reviews, 1);
  assert.equal(result.text.summary.calls, 0);
  assert.equal(result.catalog.summary.wrong, 1);
  assert.throws(() => scoreCatalog(cases, {}), /stale/);
});

test("catalog eval: bundled recordings replay every pattern without credentials", () => {
  const cli = fileURLToPath(new URL("../packages/pipeline/eval-catalog.ts", import.meta.url));
  const { policies } = JSON.parse(execFileSync(process.execPath, [cli, "--details"], {
    encoding: "utf8", env: { TYPESAFE_API_KEY: "", TYPESAFEAI_API_KEY: "" },
  }));
  assert.equal(policies.catalog.calls, 0);
  const corpus: CatalogCase[] = JSON.parse(readFileSync(new URL("../packages/pipeline/catalog-cases.json", import.meta.url), "utf8"));
  for (const pattern of new Set(corpus.map(item => item.pattern))) {
    assert.equal(policies.consensus.patterns[pattern].cases, corpus.filter(item => item.pattern === pattern).length);
  }
  assert.equal(policies.consensus.cases, corpus.length);
  assert.equal(policies.text.calls, corpus.filter(item => item.description.trim()).length);
  assert.deepEqual(Object.keys(policies.fallback.outcomes).sort(), corpus.map(item => item.id).sort());
});
