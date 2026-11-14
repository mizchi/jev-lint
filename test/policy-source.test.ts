import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { resolvePolicySource } from "../src/policy-source.ts";
import { commitSubjects } from "../src/commits.ts";
import { changeRule, tempRepo } from "./builders.ts";
import { test } from "./harness.ts";

test("policy-source: an approved revision survives a change that weakens its instructions", () => {
  const cwd = tempRepo([
    { message: "Establish policy", files: { "AGENTS.md": "- Never add left-pad.\n", "a.ts": "export const a = 1;\n" } },
    { message: "Weaken policy", files: { "AGENTS.md": "- Allow every dependency.\n", "a.ts": "export const a = 2;\n" } },
  ]);
  try {
    const policy = resolvePolicySource(cwd, "HEAD~1");
    assert.match(policy.ref, /^[a-f0-9]{40}$/);
    const subjects = commitSubjects([changeRule()], "HEAD~1..HEAD", cwd, undefined, policy.ref).subjects;
    assert.match(subjects[0]!.instructions!.docs[0]!.text, /Never add left-pad/);
    assert.throws(() => resolvePolicySource(cwd, "missing-ref"), /policy/);
    assert.throws(() => resolvePolicySource(cwd, "--all"), /policy/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("policy-source: an explicitly selected policy cannot silently omit its standard", () => {
  const cwd = tempRepo([{ message: "No standard", files: { "a.ts": "export const a = 1;\n" } }]);
  try { assert.throws(() => resolvePolicySource(cwd, "HEAD"), /instruction/); }
  finally { rmSync(cwd, { recursive: true, force: true }); }
});
