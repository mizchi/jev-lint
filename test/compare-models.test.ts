import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "./harness.ts";

test("compare-models: dry-run plans both Clef variants without credentials or writing records", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-model-plan-"));
  try {
    const result = spawnSync(process.execPath, ["tools/compare-models.ts", "--dry-run", "--json",
      "--rules", "rules/typescript/fn-name-promises", "--out", join(dir, "output")], {
      encoding: "utf8", env: { ...process.env, CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_AUTH_TOKEN: "", TYPESAFE_API_KEY: "", TYPESAFEAI_API_KEY: "" },
    });
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.ok(plan.suites[0].subjects > 0);
    assert.ok(plan.suites[0].models.clef.usd > plan.suites[0].models["clef-flash"].usd);
    assert.equal(existsSync(join(dir, "output")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("compare-models: replay scores saved records and missing answers exit 3 without changing accepted files", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-model-replay-"));
  const source = "rules/typescript/fn-name-promises/baseline.json";
  const original = readFileSync(source, "utf8");
  try {
    for (const model of ["jev", "clef"]) {
      const file = join(dir, "records", model, "typescript", "fn-name-promises.json");
      mkdirSync(join(dir, "records", model, "typescript"), { recursive: true });
      writeFileSync(file, JSON.stringify({ ...JSON.parse(original), ...(model === "clef" ? { model: "clef" } : {}) }));
    }
    const args = ["tools/compare-models.ts", "--replay", "--json", "--models", "clef",
      "--rules", "rules/typescript/fn-name-promises", "--out", dir];
    const replay = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(replay.status, 0, replay.stderr);
    const report = JSON.parse(replay.stdout);
    assert.equal(report.comparisons[0].complete, true);
    assert.equal(report.comparisons[0].regressions.length, 0);
    const partial = JSON.parse(original);
    partial.model = "clef";
    partial.passes[0][0].value = null;
    writeFileSync(join(dir, "records/clef/typescript/fn-name-promises.json"), JSON.stringify(partial));
    const incomplete = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(incomplete.status, 3, incomplete.stderr);
    assert.equal(JSON.parse(incomplete.stdout).comparisons[0].complete, false);
    assert.equal(readFileSync(source, "utf8"), original);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("compare-models: live runs save each provider separately and never rewrite accepted baselines", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-model-live-"));
  const baselinePath = "rules/typescript/fn-name-promises/baseline.json";
  const before = readFileSync(baselinePath, "utf8");
  try {
    const preload = join(dir, "transport.mjs");
    writeFileSync(preload, `globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      const result = { model: body.model === "jev-latest" ? "jev-test" : body.model,
        answers: Object.fromEntries(Object.keys(body.questions).map(q => [q, { type: "noul", noul: 0.1 }])),
        usage: { input_tokens: 100, output_tokens: 0 } };
      return Response.json(String(url).includes("api.cloudflare.com") ? { success: true, result } : result);
    };`);
    const result = spawnSync(process.execPath, ["--import", preload, "tools/compare-models.ts", "--live-jev", "--json",
      "--repeat", "2", "--rules", "rules/typescript/fn-name-promises", "--out", join(dir, "output")], {
      encoding: "utf8", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "test-account", CLOUDFLARE_API_TOKEN: "test-only",
        TYPESAFE_API_KEY: "test-only", JEV_LINT_MODEL: "jev-latest" },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.baselineSource, "live");
    assert.equal(report.comparisons.length, 2);
    assert.equal(report.comparisons[0].candidate.passes, 2);
    assert.ok(existsSync(join(dir, "output/records/jev/typescript/fn-name-promises.json")));
    assert.ok(existsSync(join(dir, "output/records/clef/typescript/fn-name-promises.json")));
    assert.ok(existsSync(join(dir, "output/records/clef-flash/typescript/fn-name-promises.json")));
    const replay = spawnSync(process.execPath, ["tools/compare-models.ts", "--replay", "--json", "--out", join(dir, "output")], { encoding: "utf8" });
    assert.equal(replay.status, 0, replay.stderr);
    assert.equal(JSON.parse(replay.stdout).comparisons.length, 2, "replay uses the original suite selection");
    assert.equal(readFileSync(baselinePath, "utf8"), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("compare-models: unknown options and missing replay records fail before inference", () => {
  const unknown = spawnSync(process.execPath, ["tools/compare-models.ts", "--dryrun"], { encoding: "utf8" });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown option/);
  const dir = mkdtempSync(join(tmpdir(), "jev-model-missing-"));
  try {
    const missing = spawnSync(process.execPath, ["tools/compare-models.ts", "--replay", "--rules",
      "rules/typescript/fn-name-promises", "--out", dir], { encoding: "utf8" });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /record/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("compare-models: a wholly refused live suite stops subsequent models and suites with incomplete results", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-model-refused-"));
  try {
    const preload = join(dir, "transport.mjs");
    writeFileSync(preload, 'globalThis.fetch = async () => new Response("denied", { status: 401 });');
    const result = spawnSync(process.execPath, ["--import", preload, "tools/compare-models.ts", "--json", "--rules",
      "rules/typescript/fn-name-promises,rules/typescript/safe-name-is-safe", "--out", join(dir, "output")], {
      encoding: "utf8", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "test-account", CLOUDFLARE_API_TOKEN: "test-only" },
    });
    assert.equal(result.status, 3, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.complete, false);
    assert.equal(report.comparisons.length, 1);
    assert.ok(report.comparisons[0].candidate.missingAnswers > 0);
    assert.equal(existsSync(join(dir, "output/records/clef-flash")), false);
    assert.equal(existsSync(join(dir, "output/records/clef/typescript/safe-name-is-safe.json")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
