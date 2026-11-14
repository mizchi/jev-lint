import { strict as assert } from "node:assert";
import { rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { scan } from "../src/audit-run.ts";
import { parseScanResult } from "../src/scan-contract.ts";
import { fakeClient, scoreRule, tempRepo } from "./builders.ts";
import { testAsync } from "./harness.ts";

await testAsync("audit-run: a scan binds every candidate to a clean source snapshot and retains low scores", async () => {
  const cwd = tempRepo([{ message: "Fixture", files: { "a.ts": "export function f() { return 1; }\n" } }]);
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const identity = { runId: "run-00001", repository: "example/project", sourceSha };
  const client = fakeClient(() => 0.1);
  const options = { cwd, rules: [scoreRule({ rule: { kind: "function_declaration" } })], paths: ["a.ts"], client, identity, namespace: "tenant", endpointIdentity: "fake" };
  try {
    const result = await scan(options);
    assert.equal(result.status, "complete");
    assert.equal(result.candidates[0]!.disposition, "below-threshold");
    assert.match(result.candidates[0]!.contextHash!, /^[a-f0-9]{64}$/);
    assert.equal(result.usage.requests, 1);
    assert.equal((await scan({ ...options, identity: { ...identity, runId: "run-00002" } })).usage.requests, 1);
    await assert.rejects(scan({ ...options, cachePath: join(cwd, "cache.json"), modelRevision: "fixed-model" }), /outside/);
    await assert.rejects(scan({ ...options, identity: { ...identity, sourceSha: "b".repeat(40) } }), /snapshot/);
    writeFileSync(join(cwd, "a.ts"), "export function f() { return 2; }\n");
    await assert.rejects(scan(options), /snapshot/);
    assert.equal(client.spent.calls, 2, "invalid provenance is rejected before sending source");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

await testAsync("audit-run: different subjects on the same line retain distinct evidence and identities", async () => {
  const cwd = tempRepo([{ message: "Fixture", files: { "a.ts": "export function a() { return 1; } export function b() { return 2; }\n" } }]);
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  try {
    const result = await scan({ cwd, rules: [scoreRule({ rule: { kind: "function_declaration" } })], paths: ["a.ts"], namespace: "tenant", endpointIdentity: "fake",
      identity: { runId: "run-00001", repository: "example/project", sourceSha }, client: fakeClient((instructions) => String(instructions.code).includes("function a") ? 0.1 : 2.5) });
    assert.equal(result.candidates.length, 2);
    assert.equal(new Set(result.candidates.map((candidate) => candidate.id)).size, 2);
    assert.equal(result.candidates.find((candidate) => candidate.evidence.includes("function b"))!.judgment!.value, 2.5);
    assert.equal(parseScanResult(result).status, "complete");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

await testAsync("audit-run: repeated identical matches keep their byte identities across passes", async () => {
  const cwd = tempRepo([{ message: "Fixture", files: { "a.ts": "export function f() { fetch('url'); fetch('url'); }\n" } }]);
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  try {
    const result = await scan({ cwd, rules: [scoreRule()], paths: ["a.ts"], namespace: "tenant", endpointIdentity: "fake", retry: 2,
      identity: { runId: "run-00001", repository: "example/project", sourceSha }, client: fakeClient(() => 0.1) });
    assert.equal(result.candidates.length, 2);
    assert.equal(result.coverage.answered, 2);
    assert.ok(result.candidates.every((candidate) => candidate.contextHash !== null));
    assert.equal(parseScanResult(result).status, "complete");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

await testAsync("audit-run: repository suppression comments cannot remove candidates from a hosted scan", async () => {
  const cwd = tempRepo([{ message: "Fixture", files: { "a.ts": "// jev-lint-ignore-file r\nexport function f() { return 1; }\n" } }]);
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  try {
    const result = await scan({ cwd, rules: [scoreRule({ rule: { kind: "function_declaration" } })], paths: ["a.ts"], namespace: "tenant", endpointIdentity: "fake",
      identity: { runId: "run-00001", repository: "example/project", sourceSha }, client: fakeClient(() => 0.1) });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.coverage.suppressed, 0);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
