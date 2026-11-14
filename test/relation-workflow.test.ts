import { strict as assert } from "node:assert";
import { Jev } from "../src/jev.ts";
import { screenRelationWorkflow, parseRelationWorkflow } from "../src/relation-workflow.ts";
import { parseRelationReport } from "../src/relations.ts";
import { relationDigest } from "../src/relation-contract.ts";
import { relationInputOf } from "./relation-fixtures.ts";
import { testAsync } from "./harness.ts";

function fixture() {
  const input = relationInputOf(); input.relations = [];
  const code = 'import { expiry } from "./units.js";\nexport function retentionDays(seconds) { return expiry(seconds); }';
  input.sources[1].content = code; input.sources[1].contentHash = relationDigest(code);
  const helper = "export function expiry(seconds) { return seconds * 1000; }";
  input.sources.push({ ...input.sources[1], id: "helper", path: "src/units.ts", content: helper, contentHash: relationDigest(helper) });
  return input;
}
function clientOf(deny = false) {
  let sends = 0;
  const client = new Jev({ apiKey: "fixture", beforeSend: async () => { if (deny) throw new Error("revoked"); }, fetch: async (_url, request) => {
    sends++;
    const body = JSON.parse(String(request?.body));
    const complete = JSON.stringify(body.state).includes("seconds * 1000");
    const choice = complete ? "supports" : "insufficient_context";
    const answer = (value: string) => ({ type: "choice", choice: value, confidence: 1, probabilities: { supports: 0, contradicts: 0, unrelated: 0, insufficient_context: 0, [value]: 1 } });
    return Response.json({ model: "fixture", answers: { q0000: answer(choice), q0001: answer("supports") }, usage: { input_tokens: 10 } });
  } });
  return { client, sends: () => sends };
}

await testAsync("relation-workflow: discovery and bounded context retrieval yield a replayable final report", async () => {
  const input = fixture(), client = clientOf();
  const result = await screenRelationWorkflow(input, { discovery: {}, client: client.client });
  assert.equal(result.discovery?.proposals.length, 1);
  assert.equal(result.rounds.length, 2);
  assert.equal(result.report.candidates[0].judgment?.choice, "supports");
  assert.ok(result.input.relations[0].context.some((e) => e.sourceId === "helper"));
  assert.equal(result.usage.requests, 2);
  assert.equal(client.sends(), 2);
  assert.equal(parseRelationReport(result.report, result.input).status, "complete");
  assert.equal(result.qualityVerdict, "UNREVIEWED");
  assert.deepEqual(await parseRelationWorkflow(result, input, { discovery: {} }), result);
  for (const field of ["usage", "stopReason", "discovery"] as const) {
    const forged = structuredClone(result) as unknown as Record<string, unknown>;
    forged[field] = field === "stopReason" ? "request-failed" : null;
    await assert.rejects(parseRelationWorkflow(forged, input, { discovery: {} }), /workflow/);
  }
});

await testAsync("relation-workflow: an empty scope cannot become a quality PASS and invalid round budgets send nothing", async () => {
  const input = fixture(), transport = clientOf(); input.claims = []; input.expectedClaimIds = [];
  const result = await screenRelationWorkflow(input, { discovery: {}, client: transport.client });
  assert.equal(result.report.candidates.length, 0); assert.equal(transport.sends(), 0); assert.equal(result.qualityVerdict, "UNREVIEWED");
  await assert.rejects(screenRelationWorkflow(input, { client: transport.client, context: { maxRounds: -1 } }), /budgets/);
  assert.equal(transport.sends(), 0);
});

await testAsync("relation-workflow: denied sends, orphan claims and exhausted context remain unreviewed", async () => {
  const input = fixture(), denied = clientOf(true);
  const failed = await screenRelationWorkflow(input, { discovery: {}, client: denied.client });
  assert.equal(failed.report.status, "failed"); assert.equal(denied.sends(), 0);
  const noContext = await screenRelationWorkflow(input, { discovery: {}, context: { maxAddedChars: 0 }, client: clientOf().client });
  assert.equal(noContext.status, "partial"); assert.equal(noContext.rounds.length, 1);
  input.expectedClaimIds.push("missing-policy");
  const missing = await screenRelationWorkflow(input, { discovery: {}, client: clientOf().client });
  assert.equal(missing.status, "partial"); assert.equal(missing.report.coverage.unplannedClaims, 1);
});
