import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { main } from "../src/cli/main.ts";
import { fakeClient, tempRepo } from "./builders.ts";
import { testAsync } from "./harness.ts";

await testAsync("cmd-scan: the CLI emits a versioned scan even when no finding clears the cutoff", async () => {
  const cwd = tempRepo([{ message: "Fixture", files: { "a.ts": "export function f() { return 1; }\n",
    "rule.yml": "id: r\nlanguage: TypeScript\nrule: { kind: function_declaration }\nask: This function hides an error.\n" } }]);
  const previous = process.cwd();
  try {
    process.chdir(cwd);
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const client = fakeClient(() => 0.1);
    let output = "";
    const args = ["scan", "a.ts", "--no-config", "--cache", "none", "-R", join(cwd, "rule.yml"), "--repository", "example/project", "--run-id", "run-00001", "--namespace", "tenant"];
    const code = await main(args, { client, out: (s) => { output += s; }, log: () => {} });
    assert.equal(code, 0);
    const report = JSON.parse(output);
    assert.equal(report.schema, "jev-lint-scan-1");
    assert.equal(report.sourceSha, sha);
    assert.equal(report.candidates.length, 1);
    assert.equal(report.candidates[0].disposition, "below-threshold");
    assert.equal(await main([...args, "--policy-ref", "missing"], { client, out: () => {}, log: () => {} }), 2);
  } finally { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); }
});
