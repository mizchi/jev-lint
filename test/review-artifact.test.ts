import { strict as assert } from "node:assert";
import { reviewScan, reviewRelations, parseReviewArtifact } from "../src/review-artifact.ts";
import { scanArtifact } from "./review-fixtures.ts";
import { test, testAsync } from "./harness.ts";
import { Jev } from "../src/jev.ts";
import { scanRelations } from "../src/relations.ts";
import { relationInputOf } from "./relation-fixtures.ts";
import { artifactSarif } from "../src/sarif.ts";
import { acceptFindings } from "../src/acceptance.ts";

test("review-artifact: invalid wire data and forged observation states cannot become accepted evidence", () => {
  const review = reviewScan(scanArtifact(), { scopeId: "local", modelRevision: "deployment-001" });
  assert.deepEqual(parseReviewArtifact(review), review);
  assert.throws(() => reviewScan({ ...scanArtifact(), repository: "../bad" }, { scopeId: "local" }));
  const broken = structuredClone(review); broken.observations[0].fingerprint = null;
  assert.throws(() => parseReviewArtifact(broken));
});

await testAsync("review-artifact: historical evidence retains its revision and unresolved owner decisions cannot be accepted", async () => {
  const input = relationInputOf(), scope = { scopeId: "service", modelRevision: "deployment-001" };
  const client = new Jev({ apiKey: "fixture", fetch: async () => Response.json({ model: "fixture", answers: {
    q0000: { type: "choice", choice: "contradicts", confidence: 1, probabilities: { supports: 0, contradicts: 1, unrelated: 0, insufficient_context: 0 } },
    q0001: { type: "choice", choice: "supports", confidence: 1, probabilities: { supports: 1, contradicts: 0, unrelated: 0, insufficient_context: 0 } },
  } }) });
  const review = reviewRelations(await scanRelations(input, { client }), input, scope);
  const related = artifactSarif(review).runs[0].results[0].relatedLocations![0];
  assert.equal(related.physicalLocation, undefined);
  assert.ok(JSON.stringify(related.logicalLocations).includes(input.sources[0].ref));
  assert.equal(acceptFindings(review).entries.length, 1);
  input.sources[1].kind = "documentation"; input.sources[1].authority = "approved";
  input.sources[1].scope = ["src"]; input.sources[1].approval = structuredClone(input.sources[0].approval);
  const decision = reviewRelations(await scanRelations(input, { client }), input, scope);
  assert.equal(decision.status, "partial"); assert.equal(decision.observations[0].state, "unassessed");
  assert.throws(() => acceptFindings(decision), /incomplete/);
});
