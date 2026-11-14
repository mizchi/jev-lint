import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { explainScope } from "../src/scope.ts";
import { scoreRule } from "./builders.ts";
import { test } from "./harness.ts";
import { execFileSync } from "node:child_process";
import { loadRules, shippedRulesPath } from "../src/rules.ts";

test("scope: exclusions and pruned directories are explicit without claiming to have counted their files", () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-scope-"));
  try {
    for (const name of ["src", "dist", ".private"]) mkdirSync(join(cwd, name));
    for (const [name, text] of Object.entries({ "src/a.ts": "export const a = 1;", "src/b.ts": "export const b = 2;", "src/readme.md": "Docs", "dist/a.ts": "Generated", ".private/key": "Not read" })) writeFileSync(join(cwd, name), text);
    symlinkSync("a.ts", join(cwd, "src/link.ts"));
    const report = explainScope({ cwd, paths: ["."], rules: [scoreRule()], exclude: ["src/b.ts"] });
    assert.equal(report.counts.eligible, 1);
    assert.ok(report.files.some((f) => f.path === "src/b.ts" && f.reason === "user-exclude"));
    assert.ok(report.files.some((f) => f.path === "src/link.ts" && f.reason === "symlink"));
    assert.equal(report.prunedDirectories.length, 2);
    assert.ok(!report.files.some((f) => f.path.startsWith("dist/")));
    assert.equal(report.modelRequests, 0);
    assert.equal(report.qualityVerdict, "UNREVIEWED");
    const diff = explainScope({ cwd, paths: ["."], rules: [scoreRule()], changedPaths: ["src/b.ts"] });
    assert.ok(diff.files.some((f) => f.path === "src/a.ts" && f.reason === "outside-change"));
    assert.equal(explainScope({ cwd, paths: ["absent"], rules: [scoreRule()] }).status, "partial");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("scope: an empty git repository is an empty inventory rather than an ignore-query failure", () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-empty-scope-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd });
    const report = explainScope({ cwd, paths: ["."], rules: [scoreRule()] });
    assert.deepEqual(report.issues, []); assert.equal(report.files.length, 0); assert.equal(report.qualityVerdict, "UNREVIEWED");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("scope: multi-language rules include JavaScript and filename constraints exclude other Markdown", () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-scope-languages-"));
  try {
    for (const path of ["app.js", "README.md", "AGENTS.md"]) writeFileSync(join(cwd, path), "Example.");
    const rules = loadRules([shippedRulesPath()!]).rules;
    const report = explainScope({ cwd, paths: ["."], rules });
    assert.ok(report.files.find((f) => f.path === "app.js")!.rules.includes("typescript/fn-name-promises"));
    assert.ok(report.files.find((f) => f.path === "AGENTS.md")!.rules.includes("markdown/agent-instructions-conflict"));
    assert.ok(!report.files.find((f) => f.path === "README.md")!.rules.includes("markdown/agent-instructions-conflict"));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
