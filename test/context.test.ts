import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cache, DEFAULT_CACHE_PATH } from "../src/cache.ts";
import { parseArgs } from "../src/cli/args.ts";
import { resolveContext } from "../src/cli/context.ts";
import { test } from "./harness.ts";

const cases: Array<{ name: string; env?: string; config?: string; flags?: string[]; expected: string | null }> = [
  { name: "default", expected: DEFAULT_CACHE_PATH },
  { name: "config", config: "configured", expected: "configured" },
  { name: "environment overrides config", env: "backend", config: "configured", expected: "backend" },
  { name: "environment enables a disabled config", env: "backend", config: "none", expected: "backend" },
  { name: "environment disables persistence", env: "none", config: "configured", expected: null },
  { name: "empty environment falls back to config", env: "", config: "configured", expected: "configured" },
  { name: "empty environment falls back to default", env: "", expected: DEFAULT_CACHE_PATH },
  { name: "long flag overrides environment", env: "backend", flags: ["--cache", "flag"], expected: "flag" },
  { name: "short flag overrides environment", env: "backend", flags: ["-c", "flag"], expected: "flag" },
  { name: "flag disables persistence", env: "backend", flags: ["--cache", "none"], expected: null },
  { name: "explicit default overrides environment", env: "backend", flags: ["--cache", DEFAULT_CACHE_PATH], expected: DEFAULT_CACHE_PATH },
];

for (const scenario of cases) {
  test(`context: cache path ${scenario.name}`, () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-context-")));
    const before = process.env.JEV_LINT_CACHE;
    try {
      if (scenario.env === undefined) delete process.env.JEV_LINT_CACHE;
      else process.env.JEV_LINT_CACHE = scenario.env;
      const config = join(dir, ".jev-lint.yaml");
      writeFileSync(config, scenario.config ? `cache: ${scenario.config}\n` : "{}\n");
      const args = ["--config", config, ...(scenario.flags ?? [])];
      const context = resolveContext(parseArgs(args, { color: false }), args, () => {});
      assert.ok(context);
      assert.equal(context.cachePath, scenario.expected === null ? null : join(dir, scenario.expected));
    } finally {
      if (before === undefined) delete process.env.JEV_LINT_CACHE;
      else process.env.JEV_LINT_CACHE = before;
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("context: environment cache paths work without a config and preserve absolute paths", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-context-")));
  const before = process.env.JEV_LINT_CACHE;
  const cwd = process.cwd();
  try {
    mkdirSync(join(dir, "nested"));
    process.chdir(join(dir, "nested"));
    for (const path of ["relative", join(dir, "absolute")]) {
      process.env.JEV_LINT_CACHE = path;
      const args = ["--no-config"];
      const context = resolveContext(parseArgs(args, { color: false }), args, () => {});
      assert.ok(context);
      assert.equal(context.cachePath, path === "relative" ? join(dir, "nested", path) : path);
    }
  } finally {
    process.chdir(cwd);
    if (before === undefined) delete process.env.JEV_LINT_CACHE;
    else process.env.JEV_LINT_CACHE = before;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("context: a 0.9 cache file is migrated into the ledger once, and a .json cache setting is read as its directory", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-context-")));
  const before = process.env.JEV_LINT_CACHE;
  try {
    delete process.env.JEV_LINT_CACHE;
    mkdirSync(join(dir, ".jev-lint"));
    const legacy = join(dir, ".jev-lint", "baseline.json");
    writeFileSync(legacy, JSON.stringify({ schema: "jev-lint-cache-4", entries: { aaaaaaaaaaaaaaaaaaaaaaaa: { value: 1, kind: "noul" } } }));
    const config = join(dir, ".jev-lint.yaml");
    writeFileSync(config, "{}\n");
    const logs: string[] = [];
    const args = ["--config", config];
    const context = resolveContext(parseArgs(args, { color: false }), args, (s) => logs.push(s));
    assert.ok(context);
    assert.equal(context.cachePath, join(dir, ".jev-lint", "verdicts"));
    assert.ok(!existsSync(legacy), "the legacy file is gone once its verdicts read back");
    assert.match(logs.join("\n"), /migrated 1 verdict\(s\).*removed in 0\.13\.0/);
    assert.deepEqual(Cache.load(context.cachePath!).get("aaaaaaaaaaaaaaaaaaaaaaaa", "noul"), { value: 1, confidence: null, kind: "noul" });
    logs.length = 0;
    assert.ok(resolveContext(parseArgs(args, { color: false }), args, (s) => logs.push(s)));
    assert.equal(logs.filter((l) => /migrated/.test(l)).length, 0, "a second run migrates nothing");

    writeFileSync(config, "cache: .jev-lint/baseline.json\n");
    const configured = resolveContext(parseArgs(args, { color: false }), args, (s) => logs.push(s));
    assert.equal(configured?.cachePath, join(dir, ".jev-lint", "verdicts"));
    assert.match(logs.join("\n"), /names a 0\.9 single-file cache/);
  } finally {
    if (before === undefined) delete process.env.JEV_LINT_CACHE;
    else process.env.JEV_LINT_CACHE = before;
    rmSync(dir, { recursive: true, force: true });
  }
});
