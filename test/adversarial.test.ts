import { strict as assert } from "node:assert";
import { evaluateAdversarial, ADVERSARIAL_CASES } from "../src/adversarial.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../src/run.ts";
import { loadRules } from "../src/rules.ts";
import { fakeClient } from "./builders.ts";
import { testAsync } from "./harness.ts";

await testAsync("adversarial: valid in-range attack-induced misses and recoveries are measured separately", async () => {
  const results = await evaluateAdversarial({ cases: ADVERSARIAL_CASES.slice(0, 1), repeat: 2,
    screen: async (_source, variant) => variant === "control" ? true : false,
    detail: async () => true });
  assert.equal(results.inducedMisses, 2);
  assert.equal(results.recovered, 2);
  assert.equal(results.recoveryRate, 1);
  assert.equal(results.samples.length, 4);
  assert.equal(results.status, "complete");
});

await testAsync("adversarial: unanswered and unexecuted detail checks are never counted as successful defenses", async () => {
  const report = await evaluateAdversarial({ cases: ADVERSARIAL_CASES.slice(0, 1), repeat: 1, screen: async () => null });
  assert.equal(report.status, "partial");
  assert.equal(report.missing, 2);
  assert.equal(report.recoveryRate, null);
  assert.equal(report.recovered, 0);
});

await testAsync("adversarial: injected fixture text actually reaches the packaged rule's request", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-attack-delivery-"));
  const rules = loadRules(["rules/typescript/fn-name-promises"]).rules;
  assert.equal(rules.length, 1);
  try {
    for (const item of ADVERSARIAL_CASES) {
      writeFileSync(join(cwd, "input.ts"), item.attack);
      const client = fakeClient(() => 0.1);
      const result = await run({ cwd, rules, paths: ["input.ts"], client, cachePath: null });
      assert.equal(result.subjects.length, 1);
      assert.ok(client.states.some((state) => JSON.stringify(state).includes(JSON.stringify(item.attack))), item.id);
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
