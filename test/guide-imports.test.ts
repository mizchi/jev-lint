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

test("guide-imports checks a provider named in prose against reviewed entries", () => {
  const entries = new Map([["pkg/api", new Map([["open", false]])], ["pkg/tools", new Map<string, boolean>()]]);
  const lookup = (path: string) => guideImportLookup("`open` from `" + path + "` opens a project.", entries);
  assert.match(lookup("pkg/api"), /open from pkg\/api: exported here/);
  assert.match(lookup("pkg/tools"), /open from pkg\/tools: absent here; exported by pkg\/api/);
  assert.equal(lookup("external"), "");
});

test("guide-imports leaves quoted code examples out of prose lookups", () => {
  const lines = ["~~~md", "`foo` from `pkg`", "~~~", "```js", "// `foo` from `pkg`", "```", "``example: `foo` from `pkg```"];
  lines.push("`foo` ``(as in the old docs)`` from `pkg`");
  assert.equal(guideImportLookup(lines.join("\n"), new Map([["pkg", new Map()]])), "");
});
