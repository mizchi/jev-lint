import assert from "node:assert/strict";
import { astGrepBin } from "../src/scan.ts";
import { rustGuideLookup } from "../src/rust-guide-imports.ts";
import { test } from "./harness.ts";

test("rust-guide-imports omits globs, external crates and shadowed paths", () => {
  const entries = new Map([["codec", new Set(["open"])]]);
  const guide = ["~~~rust", "use external as codec;", "use codec::unexpected;",
    "use ::codec::open;", "use unknown::absent;", "~~~", "~~~rust",
    "mod codec {}", "use codec::private;", "use ::codec::*;", "~~~"].join("\n");
  const evidence = rustGuideLookup(guide, entries, astGrepBin());
  assert.match(evidence, /open from codec: exported here/);
  assert.doesNotMatch(evidence, /unexpected|private|absent from all/);
});

test("rustdoc guides resolve visible imports in implicit Rust examples", () => {
  const entries = new Map([["codec", new Set(["open"])]]);
  const guide = [
    "~~~", "# use external as codec;", "use codec::shadowed;", "use ::codec::open;", "~~~",
    "~~~no_run", "# use codec::hidden;", "use codec::visible;", "~~~",
    "~~~rust, compile_fail", "use codec::intentional;", "~~~",
    "~~~text", "use codec::sample;", "~~~",
  ].join("\n");
  const evidence = rustGuideLookup(guide, entries, astGrepBin(), "rustdoc");
  assert.match(evidence, /open from codec: exported here/);
  assert.match(evidence, /visible from codec: absent from all reviewed modules/);
  assert.doesNotMatch(evidence, /shadowed|hidden|intentional|sample/);
  assert.equal(rustGuideLookup("~~~\nuse codec::open;\n~~~", entries, astGrepBin()), "");
});
