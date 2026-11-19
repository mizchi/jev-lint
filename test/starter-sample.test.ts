import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { starterSample } from "../src/cli/starter-sample.ts";
import { test } from "./harness.ts";

test("starter-sample: literal Git roots, multibyte paths and symlinks respect the inventory boundary", () => {
  const previous = process.cwd(), dir = mkdtempSync(join(tmpdir(), "jev-tracked-"));
  try {
    process.chdir(dir);
    execFileSync("git", ["init", "-q"]);
    mkdirSync("[demo]");
    for (let i = 0; i < 60; i++) writeFileSync(`[demo]/${"名".repeat(60)}-${i}.ts`, "");
    writeFileSync("outside.ts", "");
    symlinkSync("../outside.ts", "[demo]/linked.ts");
    execFileSync("git", ["add", "."]);
    writeFileSync("[demo]/untracked.ts", "");
    const { files, pathBytes, omitted } = starterSample(["[demo]"], []);
    assert.ok(files.length > 0 && omitted > 0);
    assert.equal(files.length + omitted, 60);
    assert.equal(pathBytes, files.reduce((n, path) => n + Buffer.byteLength(path), 0));
    assert.ok(pathBytes <= 8192);
    assert.ok(files.every(path => path.startsWith("[demo]/名")));
  } finally { process.chdir(previous); rmSync(dir, { recursive: true, force: true }); }
});
