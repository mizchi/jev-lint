import { strict as assert } from "node:assert";
import { Jev } from "../src/jev.ts";
import { scanRelations } from "../src/relations.ts";
import { parseRelationReport } from "../src/relation-report.ts";
import { relationInputOf } from "./relation-fixtures.ts";
import { testAsync } from "./harness.ts";

function clientOf() {
  return { client: new Jev({ apiKey: "fixture", fetch: async () => Response.json({ answers: {
    q0000: { type: "choice", choice: "contradicts", confidence: 1, probabilities: { supports: 0, contradicts: 1, unrelated: 0, insufficient_context: 0 } },
    q0001: { type: "choice", choice: "supports", confidence: 1, probabilities: { supports: 1, contradicts: 0, unrelated: 0, insufficient_context: 0 } },
  } }) }) };
}

await testAsync("relation-report: boundary validation rejects forged citations, coverage and repair direction", async () => {
  const input = relationInputOf(); const report = await scanRelations(input, { client: clientOf().client });
  assert.deepEqual(parseRelationReport(JSON.parse(JSON.stringify(report)), input), report);
  for (const mutate of [
    (raw: typeof report) => { raw.candidates[0].evidence[0].quote = "Fabricated contract."; },
    (raw: typeof report) => { raw.coverage.answered = 0; },
    (raw: typeof report) => { raw.candidates[0].resolution = "documentation"; },
    (raw: typeof report) => { raw.plan.selected = []; },
    (raw: typeof report) => { raw.inputDigest = "0".repeat(64); },
  ]) { const raw = structuredClone(report); mutate(raw); assert.throws(() => parseRelationReport(raw, input)); }
});
