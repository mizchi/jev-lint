import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { Jev } from "../src/jev.ts";
import { loadRules, shippedRulesPath } from "../src/rules.ts";
import { prepareIntrospection, introspect, parseIntrospectionReport, introspectionConfig, INTROSPECTION_QUESTION } from "../src/introspection.ts";
import { test, testAsync } from "./harness.ts";

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "jev-introspection-"));
  mkdirSync(join(cwd, "src")); mkdirSync(join(cwd, "test")); mkdirSync(join(cwd, "node_modules"));
  writeFileSync(join(cwd, "src/app.js"), "NEVER_SEND_SOURCE_BODY"); writeFileSync(join(cwd, "test/app.test.js"), "Example.");
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "NEVER_SEND_SCRIPT_COMMAND" }, dependencies: { vitest: "NEVER_SEND_VERSION" }, privateValue: "NEVER_SEND_MANIFEST_FIELD" }));
  writeFileSync(join(cwd, ".env"), "NEVER_SEND_ENV_CONTENT"); writeFileSync(join(cwd, "node_modules/dep.js"), "NEVER_SEND_DEPENDENCY");
  return { cwd, rules: loadRules([shippedRulesPath()!]).rules, close: () => rmSync(cwd, { recursive: true, force: true }) };
}
function clientOf(choice = "enable") {
  return new Jev({ apiKey: "fixture", onRequest: (body) => assert.ok(!body.includes("NEVER_SEND")), fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    return Response.json({ model: "fixture", answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, {
      type: "choice", choice, confidence: 1, probabilities: { enable: 0, defer: 0, skip: 0, insufficient_context: 0, [choice]: 1 },
    }])) });
  } });
}
test("introspection: inventory finds applicable catalog rules without reading code, secrets or dependency contents", () => {
  const f = fixture();
  try {
    const input = prepareIntrospection({ cwd: f.cwd, rules: f.rules });
    assert.ok(input.candidates.some((r) => r.key === "typescript/fn-name-promises"));
    assert.ok(!input.candidates.some((r) => r.key.startsWith("rust/")));
    assert.ok(!JSON.stringify(input).includes("NEVER_SEND"));
    assert.deepEqual(input.manifests[0].scripts, ["test"]); assert.deepEqual(input.manifests[0].dependencies, ["vitest"]);
    assert.ok(!input.files.some((f) => f.path.startsWith("node_modules/") || f.path === ".env"));
  } finally { f.close(); }
});
await testAsync("introspection: complete choices render only known enabled rules with shipped settings", async () => {
  const f = fixture();
  try {
    const input = prepareIntrospection({ cwd: f.cwd, rules: f.rules });
    const report = await introspect(input, { client: clientOf() });
    assert.equal(report.status, "complete"); assert.ok(report.coverage.enabled > 0);
    assert.deepEqual(parseIntrospectionReport(report, input), report);
    const config = parse(introspectionConfig(report, input));
    assert.deepEqual(Object.keys(config.rules), report.decisions.filter((d) => d.judgment?.choice === "enable").map((d) => d.key));
    assert.ok(Object.values(config.rules).every((value) => value === "on")); assert.ok(!("apiKey" in config));
    const forged = structuredClone(report); forged.decisions[0].key = "invented/rule";
    assert.throws(() => parseIntrospectionReport(forged, input));
    writeFileSync(join(f.cwd, "src/new.rs"), "Example.");
    assert.throws(() => parseIntrospectionReport(report, prepareIntrospection({ cwd: f.cwd, rules: f.rules })));
  } finally { f.close(); }
});
await testAsync("introspection: inventory omissions, missing answers and uncertainty cannot write a starter", async () => {
  const f = fixture();
  try {
    const partial = prepareIntrospection({ cwd: f.cwd, rules: f.rules, maxEntries: 2 });
    const limited = await introspect(partial, { client: clientOf() });
    assert.notEqual(limited.status, "complete"); assert.throws(() => introspectionConfig(limited, partial));
    const input = prepareIntrospection({ cwd: f.cwd, rules: f.rules });
    const uncertain = await introspect(input, { client: clientOf("insufficient_context") });
    assert.equal(uncertain.status, "partial"); assert.throws(() => introspectionConfig(uncertain, input));
    const failed = await introspect(input, { client: new Jev({ apiKey: "fixture", beforeSend: async () => { throw new Error("revoked"); }, fetch: async () => { throw new Error("must not send"); } }) });
    assert.equal(failed.status, "failed"); assert.ok(failed.coverage.missing > 0);
    assert.throws(() => introspectionConfig(failed, input));
  } finally { f.close(); }
});

await testAsync("introspection: caller edits cannot change the recorded question after a request is prepared", async () => {
  const f = fixture();
  try {
    const input = prepareIntrospection({ cwd: f.cwd, rules: f.rules });
    const question = structuredClone(INTROSPECTION_QUESTION), before = structuredClone(question);
    const client = new Jev({ apiKey: "fixture", fetch: async (_url, init) => {
      question.instructions.task = "Changed after sending";
      const body = JSON.parse(String(init?.body));
      return Response.json({ answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { type: "choice", choice: "defer", confidence: 1,
        probabilities: { enable: 0, defer: 1, skip: 0, insufficient_context: 0 } }])) });
    } });
    const report = await introspect(input, { client, question });
    assert.deepEqual(parseIntrospectionReport(report, input, { question: before }), report);
    assert.throws(() => parseIntrospectionReport(report, input, { question }));
  } finally { f.close(); }
});

await testAsync("introspection: forged ledgers and valid answers against a changed snapshot cannot write config", async () => {
  const f = fixture();
  try {
    const input = prepareIntrospection({ cwd: f.cwd, rules: f.rules }), report = await introspect(input, { client: clientOf() });
    const changes: Array<(r: any) => void> = [
      (r) => { r.coverage.enabled = 0; }, (r) => { r.coverage.candidates++; }, (r) => { r.questionDigest = "0".repeat(64); },
      (r) => { r.decisions.pop(); }, (r) => { r.decisions[0].judgment.probabilities.enable = 0.1; },
      (r) => { r.usage.usd = -1; }, (r) => { r.errors.push({ key: r.decisions[0].key, code: "request-failed" }); },
      (r) => { r.input.files[0].path = "invented.ts"; }, (r) => { r.extra = true; },
    ];
    for (const change of changes) { const r = structuredClone(report); change(r); assert.throws(() => parseIntrospectionReport(r, input)); }
    const stale = await introspect(input, { client: clientOf(), snapshotCheck: () => false });
    assert.equal(stale.status, "partial"); assert.equal(stale.snapshotChanged, true); assert.throws(() => introspectionConfig(stale, input));
  } finally { f.close(); }
});

await testAsync("introspection: unavailable manifests, missing parsers and inventories without candidates remain unassessed", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.cwd, "package.json"), "{ invalid manifest contents }");
    let input = prepareIntrospection({ cwd: f.cwd, rules: f.rules });
    assert.ok(input.issues.some((i) => i.code === "manifest-unavailable"));
    const report = await introspect(input, { client: clientOf() });
    assert.equal(report.status, "partial"); assert.throws(() => introspectionConfig(report, input));
    writeFileSync(join(f.cwd, "src/model.mbt"), "fn model() {}\n");
    input = prepareIntrospection({ cwd: f.cwd, rules: f.rules });
    assert.ok(input.issues.some((i) => i.code === "missing-parser"));
    rmSync(join(f.cwd, "src"), { recursive: true }); rmSync(join(f.cwd, "test"), { recursive: true }); rmSync(join(f.cwd, "package.json"));
    writeFileSync(join(f.cwd, "README.txt"), "Unknown scope.");
    input = prepareIntrospection({ cwd: f.cwd, rules: f.rules });
    const client = clientOf();
    const empty = await introspect(input, { client });
    assert.equal(empty.status, "partial"); assert.equal(empty.coverage.candidates, 0); assert.equal(client.spent.calls, 0);
    assert.throws(() => introspectionConfig(empty, input));
  } finally { f.close(); }
});
