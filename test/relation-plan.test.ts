import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planRelations, planRelationDiff, readSpecSources } from "../src/relation-plan.ts";
import { relationInputOf } from "./relation-fixtures.ts";
import { tempRepo } from "./builders.ts";
import { test } from "./harness.ts";

test("relation-plan: document changes select unchanged implementation through explicit dependencies", () => {
  const input = relationInputOf();
  assert.deepEqual(planRelations(input, { changedPaths: ["docs/contract.md"] }).selected, ["retention-code"]);
  assert.deepEqual(planRelations(input, { changedPaths: ["src/retention.ts"] }).selected, ["retention-code"]);
  assert.equal(planRelations(input, { changedPaths: ["unrelated.ts"] }).excluded[0].reason, "outside-change");
  assert.equal(planRelations(input, { maxRelations: 0 }).excluded[0].reason, "relation-budget");
  assert.equal(planRelations(input, { maxContextChars: 10 }).excluded[0].reason, "context-budget");
  input.sources[0].scope = ["another-module"];
  assert.equal(planRelations(input).excluded[0].reason, "outside-scope");
});

test("relation-plan: arbitrary specification documents are read from the pinned git version", () => {
  const cwd = tempRepo([{ message: "Contract", files: { "docs/contract.md": "Keep raw payloads for 30 days.\n" } }]);
  try {
    const ref = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
    writeFileSync(join(cwd, "docs/contract.md"), "Keep raw payloads for 90 days.\n");
    const manifest = { ...relationInputOf().sources[0], ref, path: "docs/contract.md" };
    const [source] = readSpecSources(cwd, [manifest]);
    assert.equal(source.content, "Keep raw payloads for 30 days.\n");
    assert.equal(source.ref, ref);
    assert.throws(() => readSpecSources(cwd, [{ ...manifest, path: "../outside.md" }]));
    assert.throws(() => readSpecSources(cwd, [{ ...manifest, path: "docs/missing.md" }]));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("relation-plan: a pinned git diff schedules unchanged code when its specification changes", () => {
  const input = relationInputOf();
  const cwd = tempRepo([{ message: "Sources", files: { "docs/contract.md": input.sources[0].content, "src/retention.ts": input.sources[1].content } }]);
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    const baseSha = git("rev-parse", "HEAD");
    writeFileSync(join(cwd, "docs/contract.md"), "New draft requirement.\n");
    git("add", "."); git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Draft");
    input.sourceSha = git("rev-parse", "HEAD"); input.sources[1].ref = input.sourceSha; input.sources[0].ref = baseSha;
    const plan = planRelationDiff(input, { cwd, baseSha });
    assert.deepEqual(plan.selected, ["retention-code"]);
    assert.equal(plan.baseSha, baseSha);
    assert.throws(() => planRelationDiff(input, { cwd, baseSha: "main" }));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
