import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildSuites, routeCommit } from "../packages/skill-to-decision/index.ts";
import reference from "./fixtures/skill-to-decision-reference.json" with { type: "json" };
import { test } from "./harness.ts";

const casesPath = resolve("packages/skill-to-decision/examples/commit-cases.json");
const cases = JSON.parse(readFileSync(casesPath, "utf8"));
test("skill-to-decision reproduces every historical route and suite file", () => {
  const { decisions, files } = buildSuites(cases);
  assert.deepEqual(Object.fromEntries(decisions.map(row => [row.id, [row.action, row.verdict]])), reference.routes);
  const hashes = Object.fromEntries(Object.entries(files).map(([path, text]) =>
    [path, createHash("sha256").update(text).digest("hex")]));
  assert.deepEqual(hashes, reference.files);
});

test("skill-to-decision keeps missing evidence and oversized subjects out of Jev", () => {
  const input = structuredClone(cases[0].input);
  assert.equal(routeCommit({}).action, "observe");
  assert.equal(routeCommit({ ...input, context: { ...input.context, locale: "ja" } }).action, "observe");
  input.data.message = "fix: avoid " + "a".repeat(48000);
  assert.equal(routeCommit(input).action, "observe");
});

test("skill-to-decision isolates labels from subjects and rejects split contamination", () => {
  const altered = structuredClone(cases);
  altered[0].expected = { verdict: "fail", reason: "A PRIVATE LABEL" };
  const { files, decisions } = buildSuites(altered);
  assert.deepEqual(decisions, buildSuites(cases).decisions);
  assert.ok(Object.entries(files).filter(([path]) => path.endsWith(".commitmsg")).every(([, text]) => !text.includes("PRIVATE LABEL")));
  altered[0].expected.verdict = "unknown";
  assert.throws(() => buildSuites(altered), /binary/i);
  assert.throws(() => buildSuites([...cases, { ...cases[0], id: "leaked", split: "evaluation" }]), /duplicate|split/i);
});

test("skill-to-decision export has the archived Jev dry-run plan for each split", () => {
  const temp = mkdtempSync(join(tmpdir(), "jev-skill-decision-"));
  try {
    // The archived request includes the relative fixture path in its token estimate.
    const relative = "experiments/jev/skills-01";
    mkdirSync(join(temp, "experiments/jev"), { recursive: true });
    const out = join(temp, relative);
    const cli = ["packages/skill-to-decision/cli.ts", casesPath, out];
    execFileSync(process.execPath, cli);
    assert.throws(() => execFileSync(process.execPath, cli, { stdio: "pipe" }));
    for (const split of ["develop", "evaluation"] as const) {
      const dir = join(out, split);
      const result = JSON.parse(execFileSync(process.execPath,
        [resolve("src/cli.ts"), "eval", join(relative, split), "--dry-run", "--repeat", "3", "--no-config", "--format", "json"], { cwd: temp, encoding: "utf8" }));
      assert.equal(result.failed, 0);
      assert.deepEqual(result.suites.map((s: {plan: unknown}) => s.plan), [reference.plans[split]]);
      assert.equal(readdirSync(join(dir, "text", "rulepipe-commit-imperative", "fixtures")).length, reference.plans[split].subjects);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
