import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CACHE_PATH } from "../src/cache.ts";
import { parseArgs } from "../src/cli/args.ts";
import { resolveContext } from "../src/cli/context.ts";
import { test } from "./harness.ts";

const cases: Array<{ name: string; env?: string; config?: string; flags?: string[]; expected: string | null }> = [
  { name: "default", expected: DEFAULT_CACHE_PATH },
  { name: "config", config: "configured.json", expected: "configured.json" },
  { name: "environment overrides config", env: "backend.json", config: "configured.json", expected: "backend.json" },
  { name: "environment enables a disabled config", env: "backend.json", config: "none", expected: "backend.json" },
  { name: "environment disables persistence", env: "none", config: "configured.json", expected: null },
  { name: "empty environment falls back to config", env: "", config: "configured.json", expected: "configured.json" },
  { name: "empty environment falls back to default", env: "", expected: DEFAULT_CACHE_PATH },
  { name: "long flag overrides environment", env: "backend.json", flags: ["--cache", "flag.json"], expected: "flag.json" },
  { name: "short flag overrides environment", env: "backend.json", flags: ["-c", "flag.json"], expected: "flag.json" },
  { name: "flag disables persistence", env: "backend.json", flags: ["--cache", "none"], expected: null },
  { name: "explicit default overrides environment", env: "backend.json", flags: ["--cache", DEFAULT_CACHE_PATH], expected: DEFAULT_CACHE_PATH },
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
    for (const path of ["relative.json", join(dir, "absolute.json")]) {
      process.env.JEV_LINT_CACHE = path;
      const args = ["--no-config"];
      const context = resolveContext(parseArgs(args, { color: false }), args, () => {});
      assert.ok(context);
      assert.equal(context.cachePath, path === "relative.json" ? join(dir, "nested", path) : path);
    }
  } finally {
    process.chdir(cwd);
    if (before === undefined) delete process.env.JEV_LINT_CACHE;
    else process.env.JEV_LINT_CACHE = before;
    rmSync(dir, { recursive: true, force: true });
  }
});
