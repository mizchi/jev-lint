import { strict as assert } from "node:assert";
import { introspectionDigest, parseIntrospectionInput, readIntrospectionJudgment, prepareIntrospectionQuestion, type IntrospectionInput } from "../src/introspection-contract.ts";
import { INTROSPECTION_QUESTION } from "../src/introspection.ts";
import { test } from "./harness.ts";

test("introspection-contract: a selected label must have a finite complete normalized probability vector", () => {
  const good = { type: "choice", choice: "enable", confidence: 1, probabilities: { enable: 1, defer: 0, skip: 0, insufficient_context: 0 } };
  assert.equal(readIntrospectionJudgment(good)?.choice, "enable");
  const mutations: Array<(r: any) => void> = [
    (r) => { delete r.probabilities; }, (r) => { r.choice = "invented"; }, (r) => { r.confidence = NaN; },
    (r) => { r.probabilities.enable = 0.5; }, (r) => { r.probabilities = { enable: 0.1, defer: 0.9, skip: 0, insufficient_context: 0 }; },
    (r) => { r.probabilities.extra = 0; }, (r) => { r.probabilities.defer = -1; },
  ];
  for (const change of mutations) { const r = structuredClone(good); change(r); assert.equal(readIntrospectionJudgment(r), null); }
  assert.deepEqual(prepareIntrospectionQuestion(INTROSPECTION_QUESTION), INTROSPECTION_QUESTION);
  assert.throws(() => prepareIntrospectionQuestion({ ...INTROSPECTION_QUESTION, criteria: { enable: "Always" } }));
});
test("introspection-contract: a fresh digest does not legitimize extra fields, unsafe paths or invalid metadata", () => {
  const body: Omit<IntrospectionInput, "snapshotDigest"> = { schema: "jev-lint-introspection-input-1", catalogDigest: "a".repeat(64),
    files: [{ path: "src/app.ts", eligibility: "eligible" }], manifests: [], git: false, exclude: [], candidates: [], issues: [{ path: ".", code: "no-candidates" }] };
  const input = { ...body, snapshotDigest: introspectionDigest(body) }; assert.deepEqual(parseIntrospectionInput(input), input);
  const mutations: Array<(i: any) => void> = [
    (i) => { i.apiKey = "fixture"; }, (i) => { i.files[0].path = "../private"; }, (i) => { i.files.push(i.files[0]); },
    (i) => { i.catalogDigest = "invented"; }, (i) => { i.files[0].eligibility = "approved"; },
    (i) => { i.manifests = [{ path: "src/app.ts", scripts: [], dependencies: [], values: "private" }]; },
  ];
  for (const change of mutations) {
    const i = structuredClone(input); change(i); const { snapshotDigest: _, ...data } = i; i.snapshotDigest = introspectionDigest(data);
    assert.throws(() => parseIntrospectionInput(i));
  }
});
