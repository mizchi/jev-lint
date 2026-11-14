import { strict as assert } from "node:assert";
import { expandRelationContext } from "../src/relation-context.ts";
import { indexRelationSources } from "../src/relation-discovery.ts";
import { relationDigest } from "../src/relation-contract.ts";
import { relationInputOf } from "./relation-fixtures.ts";
import { testAsync } from "./harness.ts";

export function helperInput() {
  const input = relationInputOf();
  const code = 'import { normalizeExpiry as convert } from "./units.js";\nexport function retentionDays(seconds) { return convert(seconds); }';
  const helper = 'export function normalizeExpiry(seconds) { return seconds * 1000; }';
  input.sources[1].content = code; input.sources[1].contentHash = relationDigest(code);
  input.sources.push({ ...input.sources[1], id: "units", path: "src/units.ts", content: helper, contentHash: relationDigest(helper) });
  input.relations[0].targets = [{ sourceId: "code", startLine: 2, endLine: 2, quote: code.split("\n")[1] }];
  return input;
}

await testAsync("relation-context: follows a renamed relative import to exact pinned helper lines", async () => {
  const input = helperInput(), catalog = await indexRelationSources(input);
  const expanded = expandRelationContext(input, catalog, [input.relations[0].id]);
  assert.equal(expanded.added.length, 2);
  assert.ok(expanded.input.relations[0].context.some((e) => e.quote === input.sources[2].content));
  assert.ok(expanded.input.relations[0].context.some((e) => e.quote === input.sources[1].content.split("\n")[0]));
  assert.equal(input.relations[0].context.length, 0);
  const again = expandRelationContext(expanded.input, catalog, [input.relations[0].id]);
  assert.equal(again.added.length, 0);
});

await testAsync("relation-context: unrelated same-name helpers, exhaustion and malformed catalog fail without guessing", async () => {
  const input = helperInput();
  const catalog = await indexRelationSources(input);
  const exhausted = expandRelationContext(input, catalog, [input.relations[0].id], { maxAddedChars: 0 });
  assert.equal(exhausted.added.length, 0); assert.ok(exhausted.deferred.length > 0);
  input.sources[1].content = input.sources[1].content.replace('"./units.js"', '"./missing.js"');
  input.sources[1].contentHash = relationDigest(input.sources[1].content);
  const absent = expandRelationContext(input, await indexRelationSources(input), [input.relations[0].id]);
  assert.ok(absent.added.every((e) => e.evidence.sourceId !== "units"));
  assert.throws(() => expandRelationContext(input, catalog, [input.relations[0].id]), /catalog/);
});

await testAsync("relation-context: retrieves a module constant on the first line with its exact range", async () => {
  const input = helperInput(), code = 'const HOURS_PER_DAY = 24;\nexport function retentionDays(ageDays) { return ageDays <= 30 * HOURS_PER_DAY; }';
  input.sources[1].content = code; input.sources[1].contentHash = relationDigest(code);
  input.relations[0].targets = [{ sourceId: "code", startLine: 2, endLine: 2, quote: code.split("\n")[1] }];
  const expanded = expandRelationContext(input, await indexRelationSources(input), [input.relations[0].id]);
  assert.deepEqual(expanded.added.map((e) => e.evidence), [{ sourceId: "code", startLine: 1, endLine: 1, quote: code.split("\n")[0] }]);
});
