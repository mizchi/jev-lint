import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli/main.ts";
import { testAsync } from "./harness.ts";

await testAsync("public-api-layout reviews one documented workflow across import paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-api-layout-"));
  try {
    writeFileSync(join(dir, "lib.ts"), "export declare function edit(): void; export const secret = 1;");
    writeFileSync(join(dir, "index.ts"), "export {edit as open} from './lib.js';");
    writeFileSync(join(dir, "filters.ts"), "export declare function commit(): void;");
    writeFileSync(join(dir, "guide.md"), "# Edit\nImport open and commit from canvas.\n# Preview\nUse a renderer.\n");
    const manifest = join(dir, "layout.json");
    writeFileSync(manifest, JSON.stringify({entries: {"canvas": "index.ts", "canvas/filters": "filters.ts"},
      workflows: [{guide:"guide.md", heading:"Edit"}, {guide:"guide.md", heading:"Preview"}]}));
    const out = join(dir, "out");
    let json = "";
    const logs: string[] = [];
    const code = await main(["public-api-inputs", out, "--api-layout", manifest], {out: s => { json = s; }, log: s => logs.push(s)});
    assert.equal(code, 0, logs.join("\n"));
    const result = JSON.parse(json);
    assert.equal(result.entries.length, 2);
    assert.equal(result.workflows.length, 2);
    const first = readFileSync(join(out, result.workflows[0].file), "utf8");
    assert.match(first, /^canvas: open$/m);
    assert.match(first, /^canvas\/filters: commit$/m);
    assert.match(first, /Import open and commit from canvas/);
    assert.doesNotMatch(first, /secret|Use a renderer/);
    assert.match(readFileSync(join(out, result.workflows[1].file), "utf8"), /Use a renderer/);
    assert.ok(existsSync(join(out, result.entries[0].file)));
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

await testAsync("public-api-layout rejects ambiguous guides without creating partial output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-api-layout-error-"));
  try {
    writeFileSync(join(dir, "index.ts"), "export const X = 1;");
    writeFileSync(join(dir, "guide.md"), "# One\nfirst\n# One\nsecond\n");
    const manifest = join(dir, "layout.json");
    writeFileSync(manifest, JSON.stringify({entries: {example:"index.ts"}, workflows:[{guide:"guide.md",heading:"One"}]}));
    const out = join(dir, "out");
    const logs: string[] = [];
    assert.equal(await main(["public-api-inputs", out, "--api-layout", manifest], {log:s => logs.push(s)}), 2);
    assert.match(logs.join(" "), /ambiguous-selector/);
    assert.equal(existsSync(out), false);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

await testAsync("public-api-layout matches the calibrated pair when only commit moves", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-api-layout-pair-"));
  try {
    const functions = ["open", "mapPixels", "commit", "blur"];
    writeFileSync(join(dir, "implementation.ts"), functions.map(name => "export declare function " + name + "(frame: unknown): unknown;").join("\n"));
    writeFileSync(join(dir, "guide.md"), [
      "# Edit a frame", "Open the frame, edit its pixels and commit the result. All three operations come from canvas.", "",
      "```ts", 'import { open, mapPixels, commit } from "canvas";', "commit(mapPixels(open(bytes)));", "```",
    ].join("\n"));
    const manifest = join(dir, "layout.json");
    writeFileSync(manifest, JSON.stringify({entries: {canvas:"index.ts", "canvas/filters":"filters.ts"}, workflows:[{guide:"guide.md", heading:"Edit a frame"}]}));
    for (const variant of ["root", "moved"]) {
      const root = variant === "root" ? ["open", "mapPixels", "commit"] : ["open", "mapPixels"];
      for (const [source, names] of [["index.ts", root], ["filters.ts", functions.filter(name => !root.includes(name))]] as const) {
        writeFileSync(join(dir, source), "export {" + names.join(", ") + "} from './implementation.js';");
      }
      const out = join(dir, variant);
      let json = "";
      assert.equal(await main(["public-api-inputs", out, "--api-layout", manifest], {out: s => { json = s; }}), 0);
      const [{file}] = JSON.parse(json).workflows;
      const expected = readFileSync(join("rules/text/entry-layout-obscures-workflow/fixtures", variant + ".apiworkflow"), "utf8");
      assert.equal(readFileSync(join(out, file), "utf8"), expected);
    }
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

await testAsync("public-api-layout distinguishes runtime constructors from type-only re-exports", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-api-layout-types-"));
  try {
    writeFileSync(join(dir, "runtime.ts"), "export class Session {}");
    writeFileSync(join(dir, "index.ts"), "export type {Session} from './runtime.js';");
    writeFileSync(join(dir, "star.ts"), "export type * from './runtime.js';");
    writeFileSync(join(dir, "guide.md"), "Instantiate Session from store.");
    const manifest = join(dir, "layout.json");
    writeFileSync(manifest, JSON.stringify({entries:{store:"index.ts", "store/star":"star.ts", "store/runtime":"runtime.ts"}, workflows:[{guide:"guide.md"}]}));
    const out = join(dir, "out");
    let json = "";
    assert.equal(await main(["public-api-inputs", out, "--api-layout", manifest], {out: s => { json = s; }}), 0);
    const body = readFileSync(join(out, JSON.parse(json).workflows[0].file), "utf8");
    assert.match(body, /^store: type Session$/m);
    assert.match(body, /^store\/star: type Session$/m);
    assert.match(body, /^store\/runtime: Session$/m);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

await testAsync("public-api-layout keeps Go methods on their package receiver in the workflow map", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-api-layout-go-"));
  try {
    mkdirSync(join(dir, "codec"));
    mkdirSync(join(dir, "wire"));
    writeFileSync(join(dir, "codec/api.go"), "package codec\ntype Decoder struct{}\nfunc (d Decoder) Read() {}\nfunc hidden() {}");
    writeFileSync(join(dir, "wire/api.go"), "package wire\nimport \"example.org/codec\"\nfunc NewDecoder() codec.Decoder { return codec.Decoder{} }");
    writeFileSync(join(dir, "guide.md"), "# Decode\nConstruct a decoder with wire.NewDecoder from example.org/codec/wire. Call Read on the returned codec.Decoder to consume the first record.");
    const manifest = join(dir, "layout.json");
    writeFileSync(manifest, JSON.stringify({entries:{"example.org/codec":"codec", "example.org/codec/wire":"wire"}, workflows:[{guide:"guide.md"}]}));
    const out = join(dir, "out");
    let json = "";
    assert.equal(await main(["public-api-inputs", out, "--api-layout", manifest], {out: s => { json = s; }}), 0);
    const evidence = readFileSync(join(out, JSON.parse(json).workflows[0].file), "utf8");
    assert.equal(evidence, readFileSync("rules/text/entry-layout-obscures-workflow/fixtures/go-split.apiworkflow", "utf8"));
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

await testAsync("public-api-layout never judges a truncated entry map", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-api-layout-limit-"));
  try {
    writeFileSync(join(dir, "index.ts"), "export const open = 1;");
    writeFileSync(join(dir, "guide.md"), "Use open from example.\n".repeat(2500));
    const manifest = join(dir, "layout.json");
    writeFileSync(manifest, JSON.stringify({entries:{example:"index.ts"}, workflows:[{guide:"guide.md"}]}));
    const out = join(dir, "out");
    const logs: string[] = [];
    assert.equal(await main(["public-api-inputs", out, "--api-layout", manifest], {log: s => logs.push(s)}), 2);
    assert.match(logs.join(" "), /exceeds the text budget/);
    assert.equal(existsSync(out), false);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});
