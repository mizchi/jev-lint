import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Confirm } from "../src/cli/confirm.ts";
import { main } from "../src/cli/main.ts";
import { modelCachePath } from "../src/model.ts";
import { testAsync } from "./harness.ts";

async function project(run: (requests: string[]) => Promise<void>) {
  const previous = process.cwd(), cwd = mkdtempSync(join(tmpdir(), "jev-model-cli-")), transport = globalThis.fetch;
  const keys = ["OPENROUTER_API_KEY", "TYPESAFE_API_KEY", "TYPESAFEAI_API_KEY", "JEV_LINT_MODEL"] as const;
  const environment = keys.map((key) => [key, process.env[key]] as const), requests: string[] = [];
  try {
    mkdirSync(join(cwd, "src")); writeFileSync(join(cwd, "src/a.ts"), "export function identity(n: number) { return n; }\n");
    process.chdir(cwd); execFileSync("git", ["init", "-q"]); execFileSync("git", ["add", "src"]); process.env.OPENROUTER_API_KEY = "native-fixture"; process.env.TYPESAFE_API_KEY = "jev-fixture"; delete process.env.JEV_LINT_MODEL;
    globalThis.fetch = async (url, init) => {
      const native = String(url) === "https://openrouter.ai/api/alpha/decisions";
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${native ? "native-fixture" : "jev-fixture"}`);
      const body = JSON.parse(String(init?.body)); requests.push(body.model);
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, value]) => {
        const q = value as { type: string; instructions: { candidate?: { key: string } } };
        if (q.type !== "choice") return [id, { type: "noul", noul: 0.1 }];
        const choice = q.instructions.candidate?.key === "typescript/fn-name-promises" ? "enable" : "defer";
        return [id, { type: "choice", choice, confidence: 1, probabilities: { enable: choice === "enable" ? 1 : 0, defer: choice === "defer" ? 1 : 0, skip: 0, insufficient_context: 0 } }];
      }));
      return Response.json({ model: body.model, answers, usage: { input_tokens: 100, output_tokens: 0, ...(native ? { cost: 0.0001 } : {}) } });
    };
    await run(requests);
  } finally {
    globalThis.fetch = transport; process.chdir(previous); rmSync(cwd, { recursive: true, force: true });
    for (const [key, value] of environment) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
async function cli(args: string[], confirm?: Confirm) {
  const output: string[] = [], log: string[] = [];
  const code = await main(args, { confirm, out: (text) => output.push(text), log: (text) => log.push(text) });
  return { code, value: output.length ? JSON.parse(output.join("\n")) : null, log: log.join("\n") };
}

await testAsync("cmd-model: switching native models never reuses another model's or Jev's verdict cache", async () => {
  await project(async (requests) => {
    const args = ["run", "typescript/fn-name-promises", "src", "--no-config", "--cache", "cache", "--json"];
    const a = "openrouter:liquid/d1.2", b = "openrouter:liquid/d1.2-ultra";
    assert.equal((await cli([...args, "--model", a])).code, 0);
    assert.equal(requests.length, 1); assert.ok(existsSync(modelCachePath(join(process.cwd(), "cache"), a)!));
    const cached = await cli([...args, "--model", a]); assert.equal(cached.code, 0); assert.equal(requests.length, 1);
    assert.equal((await cli([...args, "--model", b])).code, 0); assert.equal(requests.length, 2);
    assert.equal((await cli(args, async () => "approved")).code, 0);
    assert.ok(existsSync(modelCachePath(join(process.cwd(), "cache"), "openrouter:typesafe/jev-1.14")!));
    assert.equal((await cli([...args, "--model", "openrouter:typesafe/jev-1.14"])).code, 0);
    delete process.env.OPENROUTER_API_KEY;
    assert.equal((await cli(args)).code, 0); assert.ok(existsSync("cache"));
    assert.deepEqual(requests, ["liquid/d1.2", "liquid/d1.2-ultra", "typesafe/jev-1.14", "jev-1.14.0"]);
  });
});

await testAsync("cmd-model: native dry-run pricing is model-specific and makes no requests", async () => {
  await project(async (requests) => {
    const args = ["run", "typescript/fn-name-promises", "src", "--no-config", "--dry-run", "--json"];
    const free = await cli([...args, "--model", "openrouter:perplexity/pplx-decider-v1.3:free"]);
    assert.equal(free.code, 0); assert.equal(free.value.usd, 0);
    assert.ok(free.value.byRule.every((row: { usd: number }) => row.usd === 0));
    const paid = await cli([...args, "--model", "openrouter:baseten/mammoth-1"]);
    assert.equal(paid.code, 0); assert.equal(paid.value.usd, paid.value.tokens / 1_000_000 * 0.1);
    assert.equal(requests.length, 0);
  });
});

await testAsync("cmd-model: automatic startup uses the OpenRouter key for Jev selection and alternate-model checks", async () => {
  await project(async (requests) => {
    delete process.env.TYPESAFE_API_KEY; delete process.env.TYPESAFEAI_API_KEY;
    const result = await cli(["--no-config", "--cache", "none", "--json", "--model", "openrouter:liquid/d1.2"], async (message) => {
      assert.match(message, /openrouter.*liquid\/d1\.2/); assert.equal(requests.length, 0); return "approved";
    });
    assert.equal(result.code, 0, result.log);
    assert.deepEqual(requests, ["typesafe/jev-1.14", "liquid/d1.2"]);
    assert.equal(result.value.introspection.usage.requests + result.value.check.spent.calls, requests.length);
    assert.equal(result.value.introspection.model, "typesafe/jev-1.14");
    assert.equal(result.value.check.spent.usd, 0.0001);
  });
});

await testAsync("cmd-model: missing native credentials and unknown models never fall back to Jev", async () => {
  await project(async (requests) => {
    delete process.env.OPENROUTER_API_KEY;
    const missing = await cli(["--no-config", "--json", "--model", "openrouter:liquid/d1.2"]);
    assert.equal(missing.code, 3); assert.match(missing.log, /OPENROUTER_API_KEY/); assert.equal(requests.length, 0);
    const unknown = await cli(["check", "src", "--no-config", "--json", "--model", "openrouter:unknown"]);
    assert.equal(unknown.code, 2); assert.equal(requests.length, 0);
    const endpoint = await cli(["check", "src", "--no-config", "--json", "--model", "openrouter:liquid/d1.2", "--base-url", "https://example.com"]);
    assert.equal(endpoint.code, 2); assert.equal(requests.length, 0);
    const selection = await cli(["introspect", "--json", "--model", "openrouter:liquid/d1.2"]);
    assert.equal(selection.code, 2); assert.equal(requests.length, 0);
  });
});

await testAsync("cmd-model: introspect and default checking accept just the OpenRouter key", async () => {
  await project(async (requests) => {
    delete process.env.TYPESAFE_API_KEY; delete process.env.TYPESAFEAI_API_KEY;
    const result = await cli(["introspect", "--json"], async () => "approved");
    assert.equal(result.code, 0, result.log);
    assert.equal(result.value.model, "typesafe/jev-1.14");
    const check = await cli(["run", "typescript/fn-name-promises", "src", "--no-config", "--model", "jev-1.14.0", "--cache", "none", "--json"], async () => "approved");
    assert.equal(check.code, 0, check.log);
    assert.deepEqual(requests, ["typesafe/jev-1.14", "typesafe/jev-1.14"]);
  });
});

await testAsync("cmd-model: ambient OpenRouter needs consent for each run, even with --yes or a TypeSafe key", async () => {
  await project(async (requests) => {
    const args = ["run", "typescript/fn-name-promises", "src", "--cache", "none", "--json", "--yes"];
    let prompts = 0;
    const approve: Confirm = async (message) => {
      prompts++;
      assert.match(message, /OPENROUTER_API_KEY/);
      assert.match(message, /typesafe\/jev-1\.14/);
      assert.ok(!message.includes("native-fixture"));
      assert.equal(requests.length, 0);
      return "approved";
    };
    const blocked = await cli(args, async () => "unavailable");
    assert.equal(blocked.code, 2);
    assert.match(blocked.log, /--model openrouter:typesafe\/jev-1\.14/);
    writeFileSync(".jev-lint.yaml", "files: [src]\n");
    const declined = await cli(args, async () => "declined");
    assert.equal(declined.value.status, "cancelled");
    assert.equal(requests.length, 0);
    assert.equal((await cli(args, approve)).code, 0);
    assert.equal(prompts, 1);
    assert.deepEqual(requests, ["typesafe/jev-1.14"]);
  });
});

await testAsync("cmd-model: explicit project or environment model and offline plans need no provider prompt", async () => {
  await project(async (requests) => {
    const args = ["run", "typescript/fn-name-promises", "src", "--cache", "none", "--json"];
    const unexpected: Confirm = async () => { throw new Error("unexpected confirmation"); };
    assert.equal((await cli([...args, "--dry-run"], unexpected)).code, 0);
    assert.deepEqual(requests, []);
    writeFileSync(".jev-lint.yaml", "model: openrouter:typesafe/jev-1.14\n");
    assert.equal((await cli(args, unexpected)).code, 0);
    process.env.JEV_LINT_MODEL = "openrouter:typesafe/jev-1.14";
    assert.equal((await cli([...args, "--no-config"], unexpected)).code, 0);
    assert.deepEqual(requests, ["typesafe/jev-1.14", "typesafe/jev-1.14"]);
  });
});

await testAsync("cmd-model: automatic startup covers implicit OpenRouter consent for both phases once", async () => {
  await project(async (requests) => {
    const args = ["--no-config", "--cache", "none", "--json", "--yes"];
    const declined = await cli(args, async () => "declined");
    assert.equal(declined.value.status, "cancelled");
    assert.deepEqual(requests, []);
    let prompts = 0;
    const approved = await cli(args, async (message) => {
      prompts++;
      assert.match(message, /OPENROUTER_API_KEY/);
      assert.equal(requests.length, 0);
      return "approved";
    });
    assert.equal(approved.code, 0, approved.log);
    assert.equal(prompts, 1);
    assert.deepEqual(requests, ["typesafe/jev-1.14", "typesafe/jev-1.14"]);
  });
});

await testAsync("cmd-model: standalone introspection honors project OpenRouter selection, and init treats --config as output", async () => {
  await project(async (requests) => {
    writeFileSync(".jev-lint.yaml", "model: openrouter:typesafe/jev-1.14\n");
    const explicit = await cli(["introspect", "src", "--json"], async () => "declined");
    assert.equal(explicit.code, 0, explicit.log);
    assert.equal(requests.length, 1);
    const blocked = await cli(["introspect", "src", "--json", "--no-config"], async () => "unavailable");
    assert.equal(blocked.value.status, "confirmation-required");
    rmSync(".jev-lint.yaml");
    const init = await cli(["init", "--introspect", "--config", "proposal.yml", "--json"], async () => "declined");
    assert.equal(init.value.status, "cancelled");
    assert.ok(!existsSync("proposal.yml"));
    assert.equal(requests.length, 1);
  });
});

await testAsync("cmd-model: unattended document review and calibration cannot send project data on key detection", async () => {
  await project(async (requests) => {
    writeFileSync("guide.md", "Use Node 24.");
    writeFileSync("reference.md", "Use Node 24.");
    writeFileSync("manifest.json", JSON.stringify({
      schema: "jev-lint-documents-manifest-1",
      files: { guide: { path: "guide.md", role: "document" }, reference: { path: "reference.md", role: "reference" } },
      comparisons: [{ id: "runtime", topic: "Node version", mode: "semantic", reference: { source: "reference" }, target: { source: "guide" } }],
    }));
    writeFileSync(".jev-lint.yaml", "files: [src]\nrules: {typescript/fn-name-promises: on}\n");
    for (const args of [["docs", "--document-manifest", "manifest.json"], ["calibrate"], ["gaps"]]) {
      const result = await cli([...args, "--yes", "--record", "result.json", "--json"], async () => "unavailable");
      assert.equal(result.value?.status, "confirmation-required", result.log);
      assert.equal(result.code, 2);
      assert.deepEqual(requests, []);
      assert.ok(!existsSync("result.json"));
    }
  });
});

await testAsync("cmd-model: naming OPENROUTER_API_KEY in config explicitly selects its provider", async () => {
  await project(async (requests) => {
    writeFileSync(".jev-lint.yaml", "apiKeyEnv: OPENROUTER_API_KEY\n");
    const args = ["run", "typescript/fn-name-promises", "src", "--cache", "none", "--json"];
    const explicit = await cli(args, async () => "unavailable");
    assert.equal(explicit.code, 0, explicit.log);
    assert.deepEqual(requests, ["typesafe/jev-1.14"]);
    assert.equal(process.env.TYPESAFE_API_KEY, "jev-fixture");
    const ignored = await cli([...args, "--no-config"], async () => "unavailable");
    assert.equal(ignored.code, 2);
    assert.equal(requests.length, 1);
  });
});

await testAsync("cmd-model: free onboarding one-liner selects and issues rules without paid requests", async () => {
  await project(async requests => {
    delete process.env.TYPESAFE_API_KEY;
    const result = await cli(["--model", "openrouter:perplexity/pplx-decider-v1.3:free", "--json"], async () => "approved");
    assert.equal(result.code, 0, result.log);
    assert.match(result.value.starterConfig, /fn-name-promises/);
    assert.deepEqual(requests, ["perplexity/pplx-decider-v1.3:free", "perplexity/pplx-decider-v1.3:free"]);
  });
});

await testAsync("cmd-model: ambient OpenRouter alone suggests a free trial without making a paid request", async () => {
  await project(async requests => {
    delete process.env.TYPESAFE_API_KEY; delete process.env.TYPESAFEAI_API_KEY;
    const result = await cli(["--yes", "--json"], async () => { throw new Error("unexpected prompt"); });
    assert.equal(result.code, 3);
    assert.equal(result.value.status, "setup-required");
    assert.match(result.value.freeCommand, /pplx-decider-v1\.3:free$/);
    assert.match(result.log, /strongly recommend Jev with TYPESAFE_API_KEY/);
    assert.deepEqual(requests, []);
  });
});
