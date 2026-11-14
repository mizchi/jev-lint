import { strict as assert } from "node:assert";
import { Jev } from "../src/jev.ts";
import { scanRelations } from "../src/relations.ts";
import { relationInputOf } from "./relation-fixtures.ts";
import { type RelationChoice } from "../src/relation-contract.ts";
import { testAsync } from "./harness.ts";

function clientOf(choice: RelationChoice | null = "contradicts", beforeSend?: () => Promise<void>, grounding: RelationChoice = "supports") {
  const bodies: unknown[] = [];
  const client = new Jev({ apiKey: "fixture", beforeSend, fetch: async (_url, request) => {
    const body = JSON.parse(String(request?.body)); bodies.push(body);
    const answer = choice === null ? {} : { q0000: { type: "choice", choice, confidence: 1,
      probabilities: { supports: 0, contradicts: 0, unrelated: 0, insufficient_context: 0, [choice]: 1 } },
      q0001: { type: "choice", choice: grounding, confidence: 1, probabilities: { supports: 0, contradicts: 0, unrelated: 0, insufficient_context: 0, [grounding]: 1 } } };
    return Response.json({ model: "fixture-model", answers: answer, usage: { input_tokens: 10 } });
  } });
  return { client, bodies };
}

await testAsync("relations: detection preserves both citations without requiring executable repairs", async () => {
  const fixture = clientOf(); const input = relationInputOf();
  const report = await scanRelations(input, { client: fixture.client });
  assert.equal(report.status, "complete");
  assert.equal(report.candidates[0].resolution, "implementation");
  assert.deepEqual(report.candidates[0].evidence.map((e) => e.role), ["specification", "target"]);
  assert.equal(report.candidates[0].evidence[0].ref, input.sources[0].ref);
  assert.equal(report.candidates[0].evidence[1].quote, input.sources[1].content);
  assert.equal(report.usage.requests, 1);
  assert.ok(!JSON.stringify(fixture.bodies).includes("expectedChoice"));
  assert.ok(!("patches" in report.candidates[0]));
});

await testAsync("relations: a proposal cannot become normative and a guide cannot reverse repair direction", async () => {
  const input = relationInputOf();
  input.sources[0].authority = "proposal"; input.sources[0].approval = null; input.sources[0].ref = input.sourceSha;
  assert.equal((await scanRelations(input, { client: clientOf().client })).candidates[0].resolution, "needs_decision");
  input.sources[0] = relationInputOf().sources[0];
  input.sources[1].kind = "documentation"; input.sources[1].authority = "reference";
  assert.equal((await scanRelations(input, { client: clientOf().client })).candidates[0].resolution, "documentation");
});

await testAsync("relations: missing answers, context, unplanned claims and budgets remain distinct", async () => {
  const input = relationInputOf();
  const missing = await scanRelations(input, { client: clientOf(null).client });
  assert.equal(missing.status, "failed"); assert.equal(missing.coverage.missing, 1);
  assert.equal(missing.candidates[0].judgment, null);
  const context = await scanRelations(input, { client: clientOf("insufficient_context").client });
  assert.equal(context.status, "partial"); assert.equal(context.candidates[0].resolution, "needs_context");
  input.expectedClaimIds.push("not-extracted");
  const unplanned = await scanRelations(input, { client: clientOf().client });
  assert.equal(unplanned.status, "partial"); assert.equal(unplanned.coverage.unplannedClaims, 1);
  const fixture = clientOf(); const deferred = await scanRelations(input, { client: fixture.client, maxRelations: 0 });
  assert.equal(deferred.status, "partial"); assert.equal(deferred.coverage.deferred, 1); assert.equal(fixture.bodies.length, 0);
});

await testAsync("relations: authorization failure is no verdict and cannot send an additional request", async () => {
  const fixture = clientOf("supports", async () => { throw new Error("consent revoked"); });
  const report = await scanRelations(relationInputOf(), { client: fixture.client });
  assert.equal(report.status, "failed"); assert.equal(report.errors[0].code, "request-failed");
  assert.equal(fixture.bodies.length, 0);
});


await testAsync("relations: an extracted summary cannot inherit approval when its source contradicts it", async () => {
  const input = relationInputOf(); input.claims[0].statement = "Retain raw payloads for 90 days.";
  const report = await scanRelations(input, { client: clientOf("contradicts", undefined, "contradicts").client });
  assert.equal(report.candidates[0].resolution, "needs_context");
  assert.equal(report.status, "partial");
});
