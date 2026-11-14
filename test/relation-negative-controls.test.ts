import { strict as assert } from "node:assert";
import { loadNegativeControls, checkContractControl, checkGateControls } from "../tools/relation-negative-controls.ts";
import { relationDigest } from "../src/relation-contract.ts";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testAsync } from "./harness.ts";

await testAsync("relation-negative-controls: broken implementations fail their exact assertions and controls pass", async () => {
  const fixture = loadNegativeControls();
  for (const control of fixture.controls.contracts) {
    const result = checkContractControl(fixture.contractCases, control);
    assert.equal(result.passed, true, control.id);
    assert.equal(result.red.exitCode, 1);
    assert.equal(result.green.exitCode, 0);
    assert.deepEqual(result.red.checks.filter((c) => c.status === "assertion").map((c) => c.id), control.failedTests);
  }
});

await testAsync("relation-negative-controls: a fixed implementation or a syntax error cannot satisfy an expected failure", async () => {
  const fixture = loadNegativeControls(), control = fixture.controls.contracts[0];
  for (const source of [fixture.contractCases.find((c) => c.id === control.control)!.input.sources[1].content, "export function canManageBilling( {"]) {
    const cases = structuredClone(fixture.contractCases), input = cases.find((c) => c.id === control.broken)!.input;
    input.sources[1].content = source; input.sources[1].contentHash = relationDigest(source); input.relations[0].targets[0].quote = source;
    const result = checkContractControl(cases, control);
    assert.equal(result.passed, false);
  }
});

await testAsync("relation-negative-controls: every mutated evaluation fails its declared checks and CLI exit", async () => {
  const fixture = loadNegativeControls();
  const results = await checkGateControls(fixture);
  assert.equal(results.pristine.gate, "pass");
  assert.equal(results.results.length, fixture.controls.gates.length);
  for (const result of results.results) {
    assert.equal(result.passed, true, result.id);
    assert.equal(result.gate, "fail");
    assert.equal(result.exitCode, 1);
  }
});

await testAsync("relation-negative-controls: a missing expected assertion is a configuration error", async () => {
  const fixture = loadNegativeControls(), control = structuredClone(fixture.controls.contracts[0]);
  control.failedTests = ["not-present"];
  assert.throws(() => checkContractControl(fixture.contractCases, control), /negative control/);
});

await testAsync("relation-negative-controls: duplicate cases cannot inflate the negative-control count", async () => {
  const fixture = loadNegativeControls(), root = mkdtempSync(join(tmpdir(), "jev-control-manifest-"));
  try {
    mkdirSync(join(root, "experiments/relations"), { recursive: true });
    for (const duplicate of ["contract", "gate", "mutation"] as const) {
      const manifest = structuredClone(fixture.controls);
      if (duplicate === "contract") manifest.contracts.push({ ...manifest.contracts[0], id: "another-contract-id" });
      else manifest.gates.push({ ...manifest.gates[0], id: duplicate === "gate" ? manifest.gates[0].id : "another-gate-id" });
      writeFileSync(join(root, "experiments/relations/negative-controls.json"), JSON.stringify(manifest));
      assert.throws(() => loadNegativeControls(root), /invalid negative control manifest/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
