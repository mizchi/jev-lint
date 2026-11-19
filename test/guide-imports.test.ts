import assert from "node:assert/strict";
import { guideImportLookup } from "../src/guide-imports.ts";
import { test } from "./harness.ts";

test("guide-imports distinguishes a misplaced import from a name absent everywhere reviewed", () => {
  const entries = new Map([["pkg", new Map<string, boolean>()], ["pkg/io", new Map([["write", false]])]]);
  const evidence = guideImportLookup('~~~js\nimport { write, removed } from "pkg";\n~~~', entries);
  assert.match(evidence, /write from pkg: absent here; exported by pkg\/io/);
  assert.match(evidence, /removed from pkg: absent from all reviewed entries/);
});

test("guide-imports leaves unreviewed paths and non-script examples unassessed", () => {
  const guide = ['~~~md', '```ts', 'import { missing } from "pkg";', '```', '~~~',
    '```js', 'import { external } from "other";', 'import * as ns from "pkg";', '```'].join("\n");
  assert.equal(guideImportLookup(guide, new Map([["pkg", new Map()]])), "");
});

test("guide-imports parses TS assertions and JSX using the fence language", () => {
  const examples = [
    '```ts', 'const num = <number>value;', 'import { first } from "pkg";', '```',
    '```tsx', 'const view = <article />;', 'import { second } from "pkg";', '```',
  ].join("\n");
  const lookup = guideImportLookup(examples, new Map([["pkg", new Map([["first", false], ["second", false]])]]));
  assert.match(lookup, /first from pkg: exported here/);
  assert.match(lookup, /second from pkg: exported here/);
});
