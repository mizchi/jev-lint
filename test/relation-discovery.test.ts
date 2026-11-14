import { strict as assert } from "node:assert";
import { discoverRelations, indexRelationSources } from "../src/relation-discovery.ts";
import { relationDigest } from "../src/relation-contract.ts";
import { relationInputOf } from "./relation-fixtures.ts";
import { testAsync } from "./harness.ts";

await testAsync("relation-discovery: finds function candidates without changing approved claims or existing links", async () => {
  const input = relationInputOf(); input.relations = [];
  input.sources[1].content = "export function retentionDays() { return 90; }\nexport function displayName() { return 'name'; }";
  input.sources[1].contentHash = relationDigest(input.sources[1].content);
  const catalog = await indexRelationSources(input);
  const found = discoverRelations(input, catalog);
  assert.equal(found.proposals.length, 1);
  assert.equal(found.proposals[0].relation.targets[0].quote, "export function retentionDays() { return 90; }");
  assert.deepEqual(found.unmatchedClaimIds, []);
  assert.equal(input.relations.length, 0);
  assert.deepEqual(found.missingClaimIds, []);
  const bound = structuredClone(input); bound.sources[1].content += "\n"; bound.sources[1].contentHash = relationDigest(bound.sources[1].content);
  assert.throws(() => discoverRelations(bound, catalog), /catalog/);
});

await testAsync("relation-discovery: parser failure retains whole-file evidence and explicitly records degraded indexing", async () => {
  const input = relationInputOf(), previous = process.env.JEV_LINT_AST_GREP;
  try {
    process.env.JEV_LINT_AST_GREP = "/missing/jev-fixture-ast-grep";
    const catalog = await indexRelationSources(input);
    assert.ok(catalog.unindexed.some((entry) => entry.sourceId === "code" && entry.reason === "index-failed"));
    assert.ok(catalog.chunks.some((entry) => entry.evidence.quote === input.sources[1].content));
    const forged = structuredClone(catalog); forged.chunks[0].evidence.quote = "fabricated source";
    assert.throws(() => discoverRelations(input, forged), /catalog/);
  } finally {
    if (previous === undefined) delete process.env.JEV_LINT_AST_GREP; else process.env.JEV_LINT_AST_GREP = previous;
  }
});

await testAsync("relation-discovery: missing registry entries, unrelated sources, scope and budgets cannot disappear", async () => {
  const input = relationInputOf(); input.relations = []; input.expectedClaimIds.push("missing-policy");
  const catalog = await indexRelationSources(input);
  const limited = discoverRelations(input, catalog, { maxCandidates: 0 });
  assert.deepEqual(limited.missingClaimIds, ["missing-policy"]);
  assert.deepEqual(limited.deferredClaimIds, ["retention"]);
  assert.equal(limited.proposals.length, 0);
  input.sources[0].scope = ["elsewhere"];
  const scoped = discoverRelations(input, await indexRelationSources(input));
  assert.deepEqual(scoped.unmatchedClaimIds, ["retention"]);
  assert.ok(scoped.excluded.some((entry) => entry.reason === "outside-scope"));
  assert.throws(() => discoverRelations(input, catalog, { maxCandidates: -1 }));
});
