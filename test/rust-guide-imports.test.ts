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
