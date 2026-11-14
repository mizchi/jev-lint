import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderProjectFacts } from "../tools/docs-facts.ts";
import { test } from "./harness.ts";

test("docs-facts: runtime, CI and publish claims follow package changes", () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-doc-facts-"));
  try {
    mkdirSync(join(cwd, "rules"));
    const pkg = { name: "fixture", version: "0.1.0", engines: { node: ">=24" }, dependencies: { yaml: "*" }, scripts: { ci: "npm test" }, exports: { ".": "./dist/run.js" }, files: ["dist"] };
    writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg));
    const before = renderProjectFacts(cwd); assert.ok(before.includes("Node.js >=24")); assert.ok(before.includes("npm test"));
    assert.ok(before.includes("version `0.1.0`")); pkg.version = "0.2.0";
    pkg.engines.node = ">=26"; pkg.scripts.ci = "npm test && npm run docs:replay"; pkg.files.push("docs/glossary.md");
    writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg));
    const after = renderProjectFacts(cwd); assert.ok(after.includes("Node.js >=26")); assert.ok(after.includes("npm test && npm run docs:replay"));
    assert.ok(after.includes("version `0.2.0`"));
    assert.ok(after.includes("`docs/glossary.md`")); assert.notEqual(after, before);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
