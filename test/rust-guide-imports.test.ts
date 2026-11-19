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

test("grouped Rust import evidence shows the source declaration and the failing leaf with its alias", () => {
  const entries = new Map([["codec", new Set(["open", "type"])], ["codec::wire", new Set<string>()]]);
  const guide = ["~~~rust", "use codec::{open, wire::r#type as Decoder};", "~~~"].join("\n");
  const evidence = rustGuideLookup(guide, entries, astGrepBin());
  assert.match(evidence, /The guide tells the caller to add `use codec::\{open, wire::r#type as Decoder\};`/);
  assert.match(evidence, /\nuse codec::wire::r#type as Decoder;\n/);
  assert.match(evidence, /`use codec::r#type as Decoder;`/);
  const valid = guide.replace("wire::r#type", "r#type");
  assert.doesNotMatch(rustGuideLookup(valid, entries, astGrepBin()), /reproducer/);
});

test("a grouped Rust lookup keeps independent evidence and limits repairs to reviewed providers", () => {
  const entries = new Map([["codec", new Set(["open", "decode"])], ["codec::wire", new Set<string>()]]);
  const guide = ["~~~rust", "use ::codec::{open, wire::{decode, missing}};", "use codec::open as start;", "~~~"].join("\n");
  const evidence = rustGuideLookup(guide, entries, astGrepBin());
  assert.match(evidence, /\nuse ::codec::wire::decode;\n/);
  assert.match(evidence, /`use ::codec::decode;`/);
  assert.match(evidence, /missing from codec::wire: absent from all reviewed modules/);
  assert.match(evidence, /open from codec: exported here/);
  const unreviewed = new Map([["codec", new Set(["open", "decode"])]]);
  assert.doesNotMatch(rustGuideLookup(guide, unreviewed, astGrepBin()), /reproducer|absent/);
});

test("absolute paths inside a Rust group retain crate lookup under shadowing", () => {
  const entries = new Map([["codec", new Set(["open", "decode"])], ["codec::wire", new Set<string>()]]);
  const guide = ["~~~rust", "mod codec {}", "use {::codec::open, ::codec::wire::decode};", "~~~"].join("\n");
  const evidence = rustGuideLookup(guide, entries, astGrepBin());
  assert.match(evidence, /\nuse ::codec::wire::decode;\n/);
  assert.match(evidence, /`use ::codec::decode;`/);
});
