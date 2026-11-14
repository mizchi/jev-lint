import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli/main.ts";
import { Jev } from "../src/jev.ts";
import { parse } from "yaml";
import { testAsync } from "./harness.ts";

function starterClient() {
  return new Jev({ apiKey: "fixture", fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    return Response.json({ model: "fixture", answers: Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
      const enabled = (question as any).instructions.candidate.key === "typescript/fn-name-promises";
      return [key, { type: "choice", choice: enabled ? "enable" : "defer", confidence: 1,
        probabilities: { enable: enabled ? 1 : 0, defer: enabled ? 0 : 1, skip: 0, insufficient_context: 0 } }];
    })) });
  } });
}

await testAsync("cmd-introspect: init --introspect plans offline and writes only the recommended starter without --write", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-init-introspect-")), previous = process.cwd();
  try {
    writeFileSync(join(cwd, "app.ts"), "export function app() {}\n"); process.chdir(cwd);
    let output = ""; const client = starterClient(), deps = { client, out: (s: string) => { output += s; }, log: () => {} };
    assert.equal(await main(["init", "--introspect", "--dry-run", "--json"], deps), 0);
    assert.equal(JSON.parse(output).modelRequests, 0); assert.equal(client.spent.calls, 0); assert.ok(!existsSync(join(cwd, ".jev-lint.yaml")));
    output = "";
    assert.equal(await main(["init", "--introspect", "--dry-run", "--config", "planned.yaml", "--json"], deps), 0);
    assert.equal(client.spent.calls, 0); assert.ok(!existsSync(join(cwd, "planned.yaml")));
    output = "";
    assert.equal(await main(["init", "--introspect", cwd, "--json", "--record", ".jev-lint/introspection.json"], deps), 0);
    assert.equal(JSON.parse(output).status, "complete"); assert.ok(client.spent.calls > 0);
    assert.deepEqual(parse(readFileSync(join(cwd, ".jev-lint.yaml"), "utf8")).rules, { "typescript/fn-name-promises": "on" });
    const calls = client.spent.calls;
    assert.equal(await main(["init", "--introspect", "--json"], deps), 2); assert.equal(client.spent.calls, calls);
    assert.equal(await main(["init", "--config", "catalogue.yaml", "--json"], deps), 0); assert.equal(client.spent.calls, calls);
    assert.equal(parse(readFileSync(join(cwd, "catalogue.yaml"), "utf8")).rules["rust/fn-name-promises"], "on");
  } finally { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); }
});

await testAsync("cmd-introspect: init --introspect supports a new --config proposal and refuses incomplete model results", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-init-proposal-")), previous = process.cwd();
  try {
    writeFileSync(join(cwd, "app.ts"), "export function app() {}\n");
    writeFileSync(join(cwd, ".jev-lint.yaml"), "Existing calibrated settings."); process.chdir(cwd);
    const client = starterClient(), deps = { client, out: () => {}, log: () => {} };
    assert.equal(await main(["init", "--introspect", "--config", "proposal.yaml", "--json"], deps), 0);
    assert.deepEqual(parse(readFileSync(join(cwd, "proposal.yaml"), "utf8")).rules, { "typescript/fn-name-promises": "on" });
    assert.equal(readFileSync(join(cwd, ".jev-lint.yaml"), "utf8"), "Existing calibrated settings.");
    const incomplete = new Jev({ apiKey: "fixture", fetch: async () => Response.json({ answers: {} }) });
    assert.equal(await main(["init", "--introspect", "--output", "incomplete.yaml", "--json"], { ...deps, client: incomplete }), 3);
    assert.ok(!existsSync(join(cwd, "incomplete.yaml")));
  } finally { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); }
});

await testAsync("cmd-introspect: the init flag rejects other commands, hooks and conflicting targets without requests or writes", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-init-invalid-")), previous = process.cwd();
  try {
    writeFileSync(join(cwd, "app.ts"), "export function app() {}\n"); process.chdir(cwd);
    const client = starterClient(), deps = { client, out: () => {}, log: () => {} };
    for (const args of [
      ["check", "--introspect", "--dry-run"], ["init", "--introspect", "--pre-commit"], ["init", "--introspect", "--pre-push"],
      ["init", "--introspect", "--config", "a.yaml", "--output", "b.yaml"], ["init", "--introspect", "--force"],
      ["init", "--introspect", "--dry-run", "--write"],
    ]) assert.equal(await main(args, deps), 2);
    assert.equal(client.spent.calls, 0); assert.ok(!existsSync(join(cwd, ".jev-lint.yaml"))); assert.ok(!existsSync(join(cwd, ".jev-lint/hooks")));
  } finally { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); }
});

await testAsync("cmd-introspect: plans are offline, writes are exclusive and replay detects new source files", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-introspect-cli-")), previous = process.cwd();
  try {
    mkdirSync(join(cwd, "src")); writeFileSync(join(cwd, "src/app.ts"), "export function app() {}\n");
    process.chdir(cwd); let output = "";
    const client = new Jev({ apiKey: "fixture", fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return Response.json({ model: "fixture", answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, {
        type: "choice", choice: "enable", confidence: 1, probabilities: { enable: 1, defer: 0, skip: 0, insufficient_context: 0 },
      }])) });
    } }), deps = { client, out: (s: string) => { output += s; }, log: () => {} };
    const record = ".jev-lint/introspection.json";
    assert.equal(await main(["introspect", "--dry-run", "--json"], deps), 0); assert.equal(client.spent.calls, 0);
    output = "";
    assert.equal(await main(["introspect", "--write", "--record", record, "--json"], deps), 0);
    assert.equal(JSON.parse(output).status, "complete"); assert.ok(existsSync(join(cwd, ".jev-lint.yaml")));
    const config = readFileSync(join(cwd, ".jev-lint.yaml"), "utf8"), calls = client.spent.calls;
    assert.ok(calls > 0); output = "";
    assert.equal(await main(["introspect", "--write", "--json"], deps), 2);
    assert.equal(client.spent.calls, calls); assert.equal(readFileSync(join(cwd, ".jev-lint.yaml"), "utf8"), config);
    output = ""; assert.equal(await main(["introspect", "--replay", record, "--json"], deps), 0); assert.equal(client.spent.calls, calls);
    writeFileSync(join(cwd, "src/new.rs"), "fn example() {}\n");
    output = ""; assert.equal(await main(["introspect", "--replay", record, "--json"], deps), 3); assert.equal(client.spent.calls, calls);
  } finally { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); }
});

await testAsync("cmd-introspect: incomplete answers cannot create a config or overwrite a source with a record", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-introspect-cli-")), previous = process.cwd();
  try {
    writeFileSync(join(cwd, "app.ts"), "Source body."); process.chdir(cwd);
    const client = new Jev({ apiKey: "fixture", fetch: async () => Response.json({ answers: {} }) });
    const deps = { client, out: () => {}, log: () => {} };
    assert.equal(await main(["introspect", "--record", "app.ts"], deps), 2); assert.equal(client.spent.calls, 0);
    assert.equal(readFileSync(join(cwd, "app.ts"), "utf8"), "Source body.");
    assert.equal(await main(["introspect", "--write"], deps), 3); assert.ok(!existsSync(join(cwd, ".jev-lint.yaml")));
  } finally { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); }
});

await testAsync("cmd-introspect: a config created during evaluation is preserved and late inventory edits revoke writes", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "jev-introspect-race-")), previous = process.cwd();
  try {
    writeFileSync(join(cwd, "app.ts"), "export function app() {}\n"); process.chdir(cwd);
    let createConfig = true;
    const client = new Jev({ apiKey: "fixture", fetch: async (_url, init) => {
      if (createConfig) writeFileSync(join(cwd, ".jev-lint.yaml"), "User-owned configuration.");
      const body = JSON.parse(String(init?.body));
      return Response.json({ answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { type: "choice", choice: "enable", confidence: 1,
        probabilities: { enable: 1, defer: 0, skip: 0, insufficient_context: 0 } }])) });
    } });
    assert.equal(await main(["introspect", "--write", "--json"], { client, out: () => {}, log: () => {} }), 2);
    assert.equal(readFileSync(join(cwd, ".jev-lint.yaml"), "utf8"), "User-owned configuration.");
    rmSync(join(cwd, ".jev-lint.yaml")); createConfig = false;
    assert.equal(await main(["introspect", "--write", "--json"], { client,
      out: () => writeFileSync(join(cwd, "new.rs"), "pub fn new() {}"), log: () => {} }), 3);
    assert.ok(!existsSync(join(cwd, ".jev-lint.yaml")));
  } finally { process.chdir(previous); rmSync(cwd, { recursive: true, force: true }); }
});
