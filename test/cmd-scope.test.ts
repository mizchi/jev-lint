import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { main } from "../src/cli/main.ts";
import { tempRepo, fakeClient } from "./builders.ts";
import { testAsync } from "./harness.ts";

await testAsync("cmd-scope: a real base/head diff explains unchanged files and an invalid base cannot become an empty success", async () => {
  const rule = "id: name\nlanguage: TypeScript\nrule: { kind: function_declaration }\nask: The name describes behavior.\n";
  const cwd = tempRepo([{ message: "Base", files: { "src/a.ts": "export const a = 1;", "src/b.ts": "export const b = 1;", "rule.yml": rule } },
    { message: "Change", files: { "src/b.ts": "export const b = 2;" } }]);
  const previous = process.cwd();
  try {
    process.chdir(cwd); const client = fakeClient(() => 0.1); let output = "";
    const args = ["review", "src", "--no-config", "-R", "rule.yml", "--explain-scope", "--json"];
    const deps = { client, out: (s: string) => { output += s; }, log: () => {} };
    assert.equal(await main([...args, "--base", "HEAD~1"], deps), 0);
    const report = JSON.parse(output); assert.equal(report.counts.eligible, 1);
    assert.ok(report.files.some((file: { path: string; reason: string }) => file.path === "src/a.ts" && file.reason === "outside-change"));
    assert.equal(await main([...args, "--base", "absent-base"], deps), 2);
    assert.equal(client.spent.calls, 0);
  } finally { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); }
});
