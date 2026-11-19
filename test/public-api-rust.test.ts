import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli/main.ts";
import { testAsync } from "./harness.ts";

await testAsync("public-api-rust uses documented module boundaries and checks explicit Rust use trees", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-rust-"));
  try {
    const src = join(dir, "lib.rs");
    writeFileSync(src, [
      "//! Codec workflows.", "mod internal { pub fn make() {} }", "pub use internal::make as open;",
      "pub mod wire {", "/// Decode one value.", "pub fn decode(input: u8) -> u8 { input }",
      "pub(crate) fn secret() {}", "}", "#[doc(no_inline)] pub use wire::decode as unpack;", "pub struct Decoder;", "impl Decoder { pub fn read(&self) {} fn internal(&self) {} }",
    ].join("\n"));
    writeFileSync(join(dir, "Cargo.toml"), '[package]\nname="codec"\nversion="0.0.1"\nedition="2021"\n[lib]\npath="lib.rs"\n');
    execFileSync("cargo", ["doc", "--no-deps", "--offline"], { cwd: dir, env: { ...process.env, CARGO_TARGET_DIR: join(dir, "target") }, stdio: "pipe" });
    const guide = ["~~~rust", "use codec::{open as start, wire::{decode}};", "use codec::decode as wrong;",
      '// use codec::bogus;', 'let s = "use codec::bogus;";', "~~~"].join("\n");
    writeFileSync(join(dir, "guide.md"), guide);
    const layout = join(dir, "layout.json");
    writeFileSync(layout, JSON.stringify({ entries: { codec: "Cargo.toml", "codec::wire": "target/doc/codec/wire/index.html" },
      workflows: [{ guide: "guide.md" }] }));
    let crateJson = "";
    assert.equal(await main(["public-api-inputs", join(dir, "crate"), src], { out: s => { crateJson = s; } }), 0);
    assert.equal(JSON.parse(crateJson)[0].count, 4);
    assert.equal(JSON.parse(crateJson)[0].aliases, 1);
    for (const mode of ["full", "names"]) {
      const out = join(dir, mode);
      let json = "";
      const args = ["public-api-inputs", out, "--api-layout", layout];
      if (mode === "names") args.push("--workflows-only");
      assert.equal(await main(args, { out: s => { json = s; } }), 0);
      const { entries, workflows } = JSON.parse(json);
      const evidence = readFileSync(join(out, workflows[0].file), "utf8");
      assert.match(evidence, /^codec: Decoder, open, unpack \(alias of wire::decode\), wire$/m);
      assert.match(evidence, /^codec::wire: decode$/m);
      assert.match(evidence, /decode from codec: absent here; exported by codec::wire/);
      assert.match(evidence, /decode from codec::wire: exported here/);
      assert.match(evidence, /open from codec: exported here/);
      assert.doesNotMatch(evidence.split("Rust use lookup:")[1], /bogus|secret|internal/);
      if (mode === "full") {
        assert.match(readFileSync(join(out, entries[0].file), "utf8"), /pub fn read\(&self\)/);
        assert.match(readFileSync(join(out, entries[1].file), "utf8"), /pub fn decode\(input: u8\) -> u8.*Decode one value/);
      }
      assert.equal(existsSync(join(out, "bindings")), mode === "full");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await testAsync("public-api-rust reports a missing build or unenumerated re-export before writing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-rust-incomplete-"));
  try {
    writeFileSync(join(dir, "lib.rs"), "#[doc(no_inline)] pub use core::fmt::*;");
    const manifest = join(dir, "Cargo.toml");
    writeFileSync(manifest, '[package]\nname="demo"\nversion="0.1.0"\nedition="2021"\n[lib]\npath="lib.rs"\n');
    const out = join(dir, "review");
    async function check(input: string, expected: RegExp) {
      const logs: string[] = [];
      assert.equal(await main(["public-api-inputs", out, input], { log: s => logs.push(s) }), 2);
      assert.match(logs.join("\n"), expected);
      assert.equal(existsSync(out), false);
    }
    await check(manifest, /build public docs/);
    execFileSync("rustdoc", ["--edition=2021", "--crate-name", "demo", "lib.rs", "-o", "docs"], { cwd: dir });
    await check(join(dir, "docs/demo/index.html"), /cannot enumerate this rustdoc re-export/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
