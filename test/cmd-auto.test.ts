import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimateTokens } from "../src/batch.ts";
import { main } from "../src/cli/main.ts";
import { Jev, API_KEY_VARS, type AskClient } from "../src/jev.ts";
import { testAsync } from "./harness.ts";
import type { Confirm } from "../src/cli/confirm.ts";

async function project(run: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "jev-auto-")), previous = process.cwd();
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/app.ts"), "export function countUsers(rows: string[]) { return rows.length > 0; }\n");
    process.chdir(dir); execFileSync("git", ["init", "-q"]); execFileSync("git", ["add", "src"]); await run(dir);
  } finally { process.chdir(previous); rmSync(dir, { recursive: true, force: true }); }
}

function automaticClient(options: { choice?: "enable" | "defer"; missingSelection?: boolean; missingLint?: boolean; value?: number; beforeSelection?: () => void } = {}) {
  const requests: Array<{ phase: "selection" | "check"; body: any }> = [];
  const client = new Jev({ apiKey: "fixture", retries: 0, fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const selection = Object.values(body.questions).every((q: any) => q.type === "choice");
    requests.push({ phase: selection ? "selection" : "check", body });
    if (selection) options.beforeSelection?.();
    if (selection && options.missingSelection || !selection && options.missingLint) return Response.json({ answers: {} });
    return Response.json({ model: "fixture", answers: Object.fromEntries(Object.entries(body.questions).map(([key, q]: [string, any]) => {
      if (!selection) return [key, { type: "noul", noul: options.value ?? 0.1 }];
      const choice = q.instructions.candidate.key === "typescript/fn-name-promises" ? options.choice ?? "enable" : "defer";
      return [key, { type: "choice", choice, confidence: 1, probabilities: { enable: choice === "enable" ? 1 : 0, defer: choice === "defer" ? 1 : 0, skip: 0, insufficient_context: 0 } }];
    })) });
  } });
  return { client, requests };
}

async function cli(args: string[], client: AskClient | null, confirm: Confirm = async () => "approved") {
  const output: string[] = [], logs: string[] = [];
  const code = await main(args, { client, confirm, out: (s) => output.push(s), log: (s) => logs.push(s) });
  return { code, output: output.join("\n"), logs: logs.join("\n") };
}

await testAsync("cmd-auto: confirmation happens once before selection or checking and a decline makes no requests", async () => {
  await project(async (dir) => {
    const { client, requests } = automaticClient(); let prompts = 0;
    const result = await cli(["--json", "--record", "run.json"], client, async (message) => {
      prompts++; assert.equal(requests.length, 0); assert.match(message, /select.*check/i); return "declined";
    });
    assert.equal(prompts, 1); assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.output).status, "cancelled");
    assert.equal(JSON.parse(result.output).check, null);
    assert.equal(requests.length, 0);
    assert.ok(!existsSync(join(dir, "run.json"))); assert.ok(!existsSync(join(dir, ".jev-lint")));
  });
});

await testAsync("cmd-auto: approval permits selection and checking, while --yes bypasses the prompt", async () => {
  await project(async () => {
    for (const args of [[], ["--yes"], ["-y"]]) {
      const { client, requests } = automaticClient(); let prompts = 0;
      const result = await cli(["auto", "--json", "--cache", "none", ...args], client, async () => {
        prompts++; assert.equal(requests.length, 0); return "approved";
      });
      assert.equal(result.code, 0, result.logs); assert.equal(prompts, args.length ? 0 : 1);
      assert.deepEqual(requests.map((request) => request.phase), ["selection", "check"]);
    }
  });
});

await testAsync("cmd-auto: noninteractive startup requires --yes instead of spending on selection", async () => {
  await project(async () => {
    const { client, requests } = automaticClient();
    const result = await cli(["--json", "--cache", "none", "--quiet"], client, async () => "unavailable");
    assert.equal(result.code, 2); assert.match(result.logs, /--yes/);
    assert.equal(JSON.parse(result.output).status, "confirmation-required");
    assert.equal(JSON.parse(result.output).check, null); assert.equal(requests.length, 0);
  });
});

await testAsync("cmd-auto: configured startup confirms too, while offline plans and explicit check do not", async () => {
  await project(async () => {
    writeFileSync(".jev-lint.yaml", "files: [src]\nrules: {typescript/fn-name-promises: on}\ncache: none\n");
    const { client, requests } = automaticClient(); let prompts = 0;
    const decline: Confirm = async () => { prompts++; return "declined"; };
    assert.equal((await cli(["--json"], client, decline)).code, 0);
    assert.equal(prompts, 1); assert.equal(requests.length, 0);
    const unexpected: Confirm = async () => { throw new Error("must not prompt"); };
    for (const args of [["--dry-run", "--json"], ["auto", "--explain-scope", "--json"], ["check", "src", "--json"]]) {
      assert.equal((await cli(args, client, unexpected)).code, 0);
    }
    assert.deepEqual(requests.map((request) => request.phase), ["check"]);
  });
});

await testAsync("cmd-auto: inventory or configured policy changes during confirmation revoke execution", async () => {
  await project(async () => {
    const first = automaticClient();
    const changed = await cli(["auto", "--json", "--cache", "none"], first.client, async () => {
      writeFileSync("src/new.rs", "fn new() {}\n"); execFileSync("git", ["add", "src/new.rs"]); return "approved";
    });
    assert.equal(changed.code, 3); assert.equal(first.requests.length, 0);
    rmSync("src/new.rs");
    writeFileSync(".jev-lint.yaml", "files: [src]\nrules: {typescript/fn-name-promises: on}\ncache: none\n");
    const second = automaticClient();
    const modified = await cli(["--json"], second.client, async () => {
      writeFileSync(".jev-lint.yaml", "rules: {}\n"); return "approved";
    });
    assert.equal(modified.code, 3); assert.equal(second.requests.length, 0);
  });
});

await testAsync("cmd-auto: bare invocation selects starter rules then checks only the selected rules without creating configuration", async () => {
  await project(async (dir) => {
    const { client, requests } = automaticClient();
    const result = await cli(["--json", "--cache", "none"], client);
    assert.equal(result.code, 0, result.logs);
    const report = JSON.parse(result.output);
    assert.equal(report.schema, "jev-lint-auto-1"); assert.equal(report.status, "complete");
    assert.deepEqual(report.introspection.decisions.filter((d: any) => d.judgment?.choice === "enable").map((d: any) => d.key), ["typescript/fn-name-promises"]);
    assert.deepEqual(requests.map((r) => r.phase), ["selection", "check"]);
    assert.ok(Object.values(requests[1].body.questions).every((q: any) => q.instructions.matcher_captured.NAME === "countUsers"));
    assert.equal(report.check.stats.subjects, 1);
    assert.equal(report.introspection.usage.requests, 1);
    assert.equal(report.check.spent.calls, 1, "selection calls must not be charged again as lint calls");
    assert.ok(!existsSync(join(dir, ".jev-lint.yaml"))); assert.ok(!existsSync(join(dir, ".jev-lint")));
  });
});

await testAsync("cmd-auto: explicit paths and exclusions bound both metadata selection and execution", async () => {
  await project(async () => {
    writeFileSync("outside.rs", "fn outside() {}\n");
    writeFileSync("src/excluded.ts", "export function hidden() {}\n");
    writeFileSync(".env", "SOURCE_SECRET=never-send\n");
    const { client, requests } = automaticClient();
    const result = await cli(["auto", "src", "--exclude", "src/excluded.ts", "--json", "--cache", "none"], client);
    assert.equal(result.code, 0, result.logs);
    const report = JSON.parse(result.output);
    assert.deepEqual(report.introspection.input.files.map((f: any) => f.path), ["src/app.ts"]);
    assert.ok(!JSON.stringify(requests[0].body).includes("SOURCE_SECRET"));
    assert.ok(!JSON.stringify(requests[0].body).includes("return rows.length"));
    assert.equal(report.check.stats.subjects, 1);
  });
});

await testAsync("cmd-auto: dry runs and scope explanations make no requests or project files", async () => {
  await project(async (dir) => {
    const { client, requests } = automaticClient();
    const result = await cli(["--dry-run", "--json"], client);
    assert.equal(result.code, 0, result.logs);
    assert.equal(JSON.parse(result.output).schema, "jev-lint-auto-plan-1");
    assert.equal(JSON.parse(result.output).modelRequests, 0);
    assert.equal((await cli(["auto", "--explain-scope", "--json"], client)).code, 0);
    assert.equal(requests.length, 0); assert.ok(!existsSync(join(dir, ".jev-lint")));
    assert.ok(!existsSync(join(dir, ".jev-lint.yaml")));
  });
});

await testAsync("cmd-auto: existing config retains its cutoffs and file selection and bypasses introspection", async () => {
  await project(async () => {
    writeFileSync("outside.ts", "export function outside() {}\n");
    const config = "files: [src]\nrules:\n  typescript/fn-name-promises: {threshold: 0.99}\ncache: none\n";
    writeFileSync(".jev-lint.yaml", config);
    const { client, requests } = automaticClient({ value: 0.9 });
    const result = await cli(["--json"], client);
    assert.equal(result.code, 0, result.logs);
    assert.deepEqual(requests.map((r) => r.phase), ["check"]);
    assert.equal(JSON.parse(result.output).stats.subjects, 1);
    assert.equal(readFileSync(".jev-lint.yaml", "utf8"), config);
  });
});

await testAsync("cmd-auto: malformed settings and explicit check do not silently trigger automatic selection", async () => {
  await project(async () => {
    const { client, requests } = automaticClient();
    for (const config of ["rules: {unknown-rule: on}\n", "rules: {}\n", "files: [src]\n", "unexpected: value\n"]) {
      writeFileSync(".jev-lint.yaml", config);
      assert.equal((await cli(["--json"], client)).code, 2);
    }
    assert.equal(requests.length, 0);
    rmSync(".jev-lint.yaml");
    assert.equal((await cli(["check", "src", "--no-config", "--dry-run", "--json"], client)).code, 0);
    assert.equal(requests.length, 0);
  });
});

await testAsync("cmd-auto: missing selection answers or an empty starter never run every rule as fallback", async () => {
  await project(async (dir) => {
    for (const options of [{ missingSelection: true }, { choice: "defer" as const }]) {
      const { client, requests } = automaticClient(options);
      const result = await cli(["auto", "--json", "--cache", "none"], client);
      assert.equal(result.code, 3, result.logs);
      const report = JSON.parse(result.output);
      assert.equal(report.status, "incomplete"); assert.equal(report.check, null);
      assert.ok(requests.length > 0 && requests.every((r) => r.phase === "selection"));
    }
    assert.ok(!existsSync(join(dir, ".jev-lint.yaml"))); assert.ok(!existsSync(join(dir, ".jev-lint")));
  });
});

await testAsync("cmd-auto: inventory drift or a config appearing during selection prevents lint requests", async () => {
  await project(async () => {
    for (const change of [() => { writeFileSync("src/new.rs", "fn new() {}\n"); execFileSync("git", ["add", "src/new.rs"]); }, () => writeFileSync(".jev-lint.yaml", "rules: {}\n")]) {
      const { client, requests } = automaticClient({ beforeSelection: change });
      const result = await cli(["auto", "--json", "--cache", "none"], client);
      assert.equal(result.code, 3, result.logs);
      assert.equal(JSON.parse(result.output).check, null);
      assert.ok(requests.every((r) => r.phase === "selection"));
      rmSync("src/new.rs", { force: true }); rmSync(".jev-lint.yaml", { force: true });
    }
  });
});

await testAsync("cmd-auto: findings and missing lint answers retain normal exits and replayable lint records", async () => {
  await project(async () => {
    const flagged = automaticClient({ value: 0.95 });
    const result = await cli(["auto", "--json", "--cache", "none", "--record", "run.json"], flagged.client);
    assert.equal(result.code, 1, result.logs);
    assert.equal(JSON.parse(result.output).check.findings.length, 1);
    assert.equal(JSON.parse(readFileSync("run.json", "utf8")).schema, "jev-lint-run-1");
    assert.equal((await cli(["replay", "run.json", "--no-config", "--json"], flagged.client)).code, 1);
    const missing = automaticClient({ missingLint: true });
    const failed = await cli(["auto", "--json", "--cache", "none"], missing.client);
    assert.equal(failed.code, 3, failed.logs);
    assert.equal(JSON.parse(failed.output).status, "incomplete");
    assert.equal(JSON.parse(failed.output).check.stats.missing, 1);
  });
});

await testAsync("cmd-auto: invalid workflow options are rejected before model requests", async () => {
  await project(async () => {
    const { client, requests } = automaticClient();
    for (const args of [["--write"], ["--output", "proposal.yaml"], ["--replay"], ["--staged"], ["--base", "main"], ["--file", "rule.yml"]]) {
      assert.equal((await cli(["auto", ...args, "--json"], client)).code, 2, args.join(" "));
    }
    assert.equal(requests.length, 0);
  });
});

await testAsync("cmd-auto: incomplete inventories stop before inference and no-config explicitly bypasses existing settings", async () => {
  await project(async () => {
    const { client, requests } = automaticClient();
    for (const path of ["missing-directory", "../outside-project"]) {
      const result = await cli(["auto", path, "--json", "--cache", "none"], client);
      assert.equal(result.code, 3, result.logs);
      assert.equal(JSON.parse(result.output).check, null);
    }
    assert.equal(requests.length, 0);
    writeFileSync(".jev-lint.yaml", "rules: {unknown-rule: on}\n");
    assert.equal((await cli(["auto", "src", "--no-config", "--cache", "none", "--json"], client)).code, 0);
    assert.equal(readFileSync(".jev-lint.yaml", "utf8"), "rules: {unknown-rule: on}\n");
  });
});

await testAsync("cmd-auto: threshold overrides and severity gates apply after selection", async () => {
  await project(async () => {
    for (const args of [["--threshold", "typescript/fn-name-promises=0.99"], ["--fail-on", "error"]]) {
      const { client } = automaticClient({ value: 0.95 });
      const result = await cli(["auto", "--json", "--cache", "none", ...args], client);
      assert.equal(result.code, 0, result.logs);
      assert.equal(JSON.parse(result.output).introspection.coverage.enabled, 1);
    }
  });
});

await testAsync("cmd-auto: missing credentials explain the required environment while offline plans remain usable", async () => {
  await project(async () => {
    const previous = API_KEY_VARS.map((key) => [key, process.env[key]] as const);
    try {
      for (const key of API_KEY_VARS) delete process.env[key];
      assert.equal((await cli(["--dry-run", "--json"], null)).code, 0);
      const result = await cli(["--json", "--cache", "none"], null);
      assert.equal(result.code, 3);
      assert.match(result.logs, /TYPESAFE_API_KEY/);
      assert.match(result.logs, /https:\/\/console\.typesafe\.ai\/keys/);
      assert.match(result.logs, /export TYPESAFE_API_KEY=/);
      assert.match(result.logs, /npx -y jev-lint --model openrouter:perplexity\/pplx-decider-v1\.3:free/);
      assert.equal(JSON.parse(result.output).check, null);
    } finally {
      for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
});

await testAsync("cmd-auto: a client with mutable spend counters still charges each phase once", async () => {
  await project(async () => {
    const { client } = automaticClient(), spent = { ...client.spent };
    const shared: AskClient = { get model() { return client.model; }, get servedModel() { return client.servedModel; }, spent,
      askSplitting: async (state, questions) => {
        const result = await client.askSplitting(state, questions); Object.assign(spent, client.spent); return result;
      },
    };
    const result = await cli(["auto", "--json", "--cache", "none"], shared);
    assert.equal(result.code, 0, result.logs);
    const report = JSON.parse(result.output);
    assert.equal(report.introspection.usage.requests, 1); assert.equal(report.check.spent.calls, 1);
    assert.equal(spent.calls, 2);
  });
});

await testAsync("cmd-auto: pretty, GitHub and SARIF results preserve check output and exit status", async () => {
  await project(async () => {
    for (const format of ["pretty", "github", "sarif"]) {
      const { client } = automaticClient({ value: 0.95 });
      const result = await cli(["auto", "--format", format, "--cache", "none", "--no-color"], client);
      assert.equal(result.code, 1, result.logs);
      assert.match(result.logs, /auto: selected typescript\/fn-name-promises/);
      if (format === "sarif") assert.equal(JSON.parse(result.output).version, "2.1.0");
      else assert.match(result.output, /fn-name-promises/);
    }
  });
});

await testAsync("cmd-auto: first run proposes a starter from bounded tracked paths only", async () => {
  await project(async () => {
    for (let i = 0; i < 100; i++) writeFileSync(`src/f${i}.ts`, "export const tracked = true;");
    execFileSync("git", ["add", "src"]);
    writeFileSync("src/private.ts", "never send this");
    const { client, requests } = automaticClient();
    const result = await cli(["--json", "--cache", "none"], client);
    assert.equal(result.code, 0, result.logs);
    const report = JSON.parse(result.output);
    assert.ok(requests.some(r => r.phase === "check"));
    assert.equal(report.sample.lintFiles.length, 3);
    assert.ok(!JSON.stringify(requests).includes("never send this"));
    assert.match(report.starterConfig, /typescript\/fn-name-promises: on/);
    const paths = report.introspection.input.files.map((f: {path: string}) => f.path);
    assert.equal(paths.length, 64);
    assert.ok(!paths.includes("src/private.ts"));
    assert.equal(report.sample.omitted, 37);
    assert.equal(requests[0].body.state.inventoryComplete, false);
    assert.ok(!existsSync(".jev-lint.yaml"));
  });
});

await testAsync("cmd-auto: starter YAML precedes lint and oversized files stay out of its payload", async () => {
  await project(async () => {
    for (const file of ["a", "b", "c", "d"]) {
      writeFileSync(`src/${file}.ts`, `export function ${file}() { return true; }\n`.padEnd(file === "a" ? 16385 : 16384));
    }
    execFileSync("git", ["add", "src"]);
    const result = await cli(["--json", "--cache", "none"], automaticClient().client);
    assert.equal(result.code, 0, result.logs);
    const report = JSON.parse(result.output);
    const files = report.sample.lintFiles as string[];
    assert.ok(files.length > 0 && files.length <= 3);
    assert.ok(!files.includes("src/a.ts"));
    assert.ok(files.reduce((n, path) => n + readFileSync(path).length, 0) <= 32768);
    let yaml = false, checked = false;
    const client = automaticClient().client;
    const original = client.askSplitting.bind(client);
    client.askSplitting = async (state, questions) => {
      if (Object.values(questions).some(q => q.type !== "choice")) { assert.ok(yaml); checked = true; }
      return original(state, questions);
    };
    assert.equal(await main(["--cache", "none"], { client, confirm: async () => "approved", log: () => {},
      out: s => { if (s.includes("typescript/fn-name-promises: on")) yaml = true; } }), 0);
    assert.ok(checked);
  });
});

await testAsync("cmd-auto: a trial from a Git subdirectory uses relative tracked paths", async () => {
  await project(async () => {
    writeFileSync("outside.ts", "export function outside() {}");
    execFileSync("git", ["add", "outside.ts"]);
    process.chdir("src");
    const result = await cli(["--dry-run", "--json"], null);
    assert.equal(result.code, 0, result.logs);
    const plan = JSON.parse(result.output);
    assert.deepEqual(plan.input.files.map((file: {path: string}) => file.path), ["app.ts"]);
    assert.equal(plan.input.git, true);
  });
});

await testAsync("cmd-auto: mixed-language starter questions fit the TypeSafe trial budget", async () => {
  await project(async () => {
    for (const ext of ["go", "rs", "py", "rb", "js", "tsx", "cs", "kt", "java", "php", "swift", "md"]) {
      writeFileSync(`src/main.${ext}`, "");
    }
    execFileSync("git", ["add", "src"]);
    const { client, requests } = automaticClient();
    await cli(["--json", "--cache", "none"], client);
    assert.ok(requests.length);
    assert.ok(estimateTokens(requests[0].body) <= 32000);
    assert.ok(Object.keys(requests[0].body.questions).length <= 12);
  });
});
