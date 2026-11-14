import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../src/cli/main.ts";
import { scanArtifact } from "./review-fixtures.ts";
import { testAsync } from "./harness.ts";
import { fakeClient } from "./builders.ts";

await testAsync("cmd-artifact: offline baseline commands and SARIF export require no model and preserve incomplete baselines", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-baseline-cli-"));
  try {
    const artifact = join(cwd, "scan.json"), baseline = join(cwd, "accepted.json"), scan = scanArtifact();
    writeFileSync(artifact, JSON.stringify(scan));
    let output = "";
    const deps = { out: (s: string) => { output += s; }, log: () => {} };
    const args = ["--artifact", artifact, "--baseline", baseline, "--scope-id", "service", "--model-revision", "deployment-001", "--no-config"];
    assert.equal(await main(["baseline", "write", ...args], deps), 0);
    assert.ok(existsSync(baseline)); const accepted = readFileSync(baseline, "utf8");
    output = ""; assert.equal(await main(["baseline", "compare", ...args], deps), 0);
    assert.equal(JSON.parse(output).counts.accepted, 1);
    output = ""; assert.equal(await main(["report", "--artifact", artifact, "--sarif"], deps), 0);
    assert.equal(JSON.parse(output).version, "2.1.0");
    scan.status = "failed"; scan.coverage.answered = 0; scan.coverage.missing = 1; scan.candidates[0].judgment = null; scan.candidates[0].disposition = "missing";
    writeFileSync(artifact, JSON.stringify(scan));
    assert.equal(await main(["baseline", "prune", ...args], deps), 3);
    assert.equal(readFileSync(baseline, "utf8"), accepted);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

await testAsync("cmd-artifact: live check SARIF and file preflight keep stdout machine-readable and preflight never calls the model", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-sarif-cli-")), previous = process.cwd();
  try {
    writeFileSync(join(cwd, "a.ts"), "export function f() { return 1; }");
    writeFileSync(join(cwd, "rule.yml"), "id: name\nlanguage: TypeScript\nkind: noul\nthreshold: 0.5\nrule: { kind: function_declaration }\nask: The name describes behavior.\ncriteria: { 'true': Correct, 'false': Incorrect }\n");
    process.chdir(cwd); let output = "";
    const client = fakeClient(() => 0.9), deps = { client, out: (s: string) => { output += s; }, log: () => {} };
    const args = ["check", "a.ts", "--no-config", "--cache", "none", "-R", "rule.yml"];
    assert.equal(await main([...args, "--sarif", "--explain-schedule"], deps), 1);
    assert.equal(JSON.parse(output).runs[0].results.length, 1); const calls = client.spent.calls;
    output = ""; assert.equal(await main([...args, "--explain-scope", "--json"], deps), 0);
    assert.equal(JSON.parse(output).counts.eligible, 1); assert.equal(client.spent.calls, calls);
    output = ""; const code = await main(["doctor", "--json", "--no-config", "-R", "rule.yml"], deps);
    assert.ok(code === 0 || code === 3); assert.equal(JSON.parse(output).modelRequests, 0); assert.equal(client.spent.calls, calls);
    assert.equal(await main([...args, "--sarif", "--dry-run"], deps), 2);
  } finally { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); }
});
