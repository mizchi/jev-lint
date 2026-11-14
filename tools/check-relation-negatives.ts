import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadNegativeControls, checkContractControl, checkGateControls } from "./relation-negative-controls.ts";

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--out" || !args[1])) throw new Error("usage: check-relation-negatives [--out path]");
const fixture = loadNegativeControls();
const contracts = fixture.controls.contracts.map((control) => checkContractControl(fixture.contractCases, control));
const gates = await checkGateControls(fixture);
const passed = contracts.every((control) => control.passed) && gates.results.every((control) => control.passed);
const output = resolve(args[1] ?? "experiments/relations/negative-controls/last.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ schema: "jev-lint-negative-controls-1", mode: "offline-negative-controls", passed, contracts, gates }, null, 2)}\n`);
for (const control of contracts) process.stdout.write(`${control.id}: Red exit ${control.red.exitCode} (expected 1), Green exit ${control.green.exitCode} (expected 0): ${control.passed ? "ok" : "FAIL"}\n`);
for (const control of gates.results) process.stdout.write(`${control.id}: gate ${control.gate}, CLI exit ${control.exitCode} (expected 1): ${control.passed ? "ok" : "FAIL"}\n`);
process.stdout.write(`${output}\n${passed ? "All expected failures were observed." : "A negative control did not fail as expected."}\n`);
process.exitCode = passed ? 0 : 1;
