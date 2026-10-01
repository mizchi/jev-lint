import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Clef, CLEF_USD_PER_MTOK } from "../src/clef.ts";
import { JevError, Pacer } from "../src/jev.ts";
import { run } from "../src/run.ts";
import type { Question } from "../src/types.ts";
import { noulRule } from "./builders.ts";
import { testAsync } from "./harness.ts";

const questions = (count: number): Record<string, Question> => Object.fromEntries(
  Array.from({ length: count }, (_, i) => [`q${i}`, {
    type: "noul", instructions: { ask: "Does the name misdescribe the body?" },
    criteria: { true: "yes", false: "no" },
  }]),
);

await testAsync("clef: Workers AI receives the same state and questions and the envelope is unwrapped", async () => {
  const state = { code: "function pure() { write(); }" };
  const qs = questions(1);
  const client = new Clef({ accountId: "test-account", apiKey: "test-only", retries: 0,
    fetch: async (url, init) => {
      assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/test-account/ai/run/@cf/cloudflare/clef");
      assert.deepEqual(JSON.parse(String(init?.body)), { model: "clef", state, questions: qs });
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-only");
      return Response.json({ success: true, result: {
        model: "clef", answers: { q0: { type: "noul", noul: 0.8 } },
        usage: { input_tokens: 100, output_tokens: 0 },
      } });
    },
  });
  assert.deepEqual((await client.askSplitting(state, qs)).answers, { q0: { type: "noul", noul: 0.8 } });
  assert.equal(client.servedModel, "clef");
  assert.equal(client.spent.inputTokens, 100);
  assert.equal(client.spent.usd, 100 / 1_000_000 * CLEF_USD_PER_MTOK.clef);
});

await testAsync("clef: more than 64 questions are split before sending and repeated state is billed", async () => {
  const sizes: number[] = [];
  const state = { code: "source" };
  const client = new Clef({ model: "clef-flash", accountId: "test-account", apiKey: "test-only", retries: 0,
    fetch: async (url, init) => {
      assert.match(String(url), /\/clef-flash$/);
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.state, state);
      assert.equal(body.model, "clef-flash");
      sizes.push(Object.keys(body.questions).length);
      return Response.json({ success: true, result: {
        model: "clef-flash", answers: Object.fromEntries(Object.keys(body.questions).map(q => [q, { type: "noul", noul: 0.3 }])),
        usage: { input_tokens: 100, output_tokens: 0 },
      } });
    },
  });
  assert.equal(Object.keys((await client.askSplitting(state, questions(130))).answers!).length, 130);
  assert.deepEqual(sizes, [64, 64, 2]);
  assert.equal(client.spent.calls, 3);
  assert.equal(client.spent.splits, 2);
  assert.equal(client.spent.inputTokens, 300);
  assert.equal(client.spent.usd, 300 / 1_000_000 * CLEF_USD_PER_MTOK["clef-flash"]);
});

await testAsync("clef: an empty question set needs no credentials or request", async () => {
  const client = new Clef({ accountId: "", apiKey: "", fetch: async () => { throw new Error("must not send"); } });
  assert.deepEqual((await client.askSplitting({}, {})).answers, {});
  assert.equal(client.spent.calls, 0);
});

await testAsync("clef: missing account or token fails as auth before transport", async () => {
  for (const options of [{ accountId: "", apiKey: "test-only" }, { accountId: "test-account", apiKey: "" }]) {
    const client = new Clef({ ...options, fetch: async () => { throw new Error("must not send"); } });
    await assert.rejects(() => client.askSplitting({}, questions(1)), (e: unknown) => e instanceof JevError && e.kind === "auth");
  }
});

await testAsync("clef: failed envelopes, malformed replies, missing usage and HTTP failures yield no verdict", async () => {
  const failures = [
    () => Response.json({ success: false, errors: [{ code: 10000, message: "rejected" }] }),
    () => new Response("not json"),
    () => Response.json({ success: true, result: { model: "clef", answers: {} } }),
    () => Response.json({ success: true, result: { model: "clef", answers: {}, usage: { input_tokens: -1, output_tokens: 0 } } }),
    () => Response.json({ success: true, result: { model: "clef", answers: [], usage: { input_tokens: 10, output_tokens: 0 } } }),
    () => new Response("denied", { status: 401 }),
    () => new Response("unavailable", { status: 503 }),
    () => { throw new Error("connection closed"); },
  ];
  const rule = noulRule({ language: "TypeScript", rule: { kind: "function_declaration" }, threshold: 0.5 });
  const dir = mkdtempSync(join(tmpdir(), "jev-clef-"));
  writeFileSync(join(dir, "pure.ts"), "function pure() { write(); }\n");
  try {
    for (const response of failures) {
      const client = new Clef({ accountId: "test-account", apiKey: "test-only", retries: 0, rateLimitRetries: 0,
        fetch: async () => response(),
      });
      const result = await run({ rules: [rule], paths: [dir], client, cachePath: null });
      assert.equal(result.stats.missing, 1);
      assert.equal(result.findings.length, 0);
      assert.equal(result.errors?.length, 1);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await testAsync("clef: a rate limit retries the same question and counts only successful token usage", async () => {
  let calls = 0;
  const client = new Clef({ accountId: "test-account", apiKey: "test-only", retries: 0,
    rateLimitRetries: 1, rateLimitWaitMs: 0, pacer: new Pacer(1_000_000, 1_000_000),
    fetch: async () => ++calls === 1 ? new Response("limited", { status: 429, headers: { "retry-after": "0" } }) :
      Response.json({ success: true, result: { model: "clef", answers: { q0: { type: "noul", noul: 0.1 } },
        usage: { input_tokens: 10, output_tokens: 0 } } }),
  });
  assert.ok((await client.askSplitting({}, questions(1))).answers?.q0);
  assert.equal(calls, 2);
  assert.equal(client.spent.rateLimited, 1);
  assert.equal(client.spent.calls, 1);
  assert.equal(client.spent.inputTokens, 10);
});

await testAsync("clef: timed-out transport is aborted and reported as a transient failure", async () => {
  const client = new Clef({ accountId: "test-account", apiKey: "test-only", retries: 0, timeoutMs: 5,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  await assert.rejects(() => client.askSplitting({}, questions(1)), (e: unknown) => e instanceof JevError && e.kind === "transient");
});

await testAsync("clef: raw System One replies and score/choice fields are preserved", async () => {
  const result = { model: "clef", answers: {
    score: { type: "score", score: 1.2, confidence: 0.6, probabilities: { "0": 0.4, "2": 0.6 }, legend: {} },
    choice: { type: "choice", choice: "a", confidence: 0.8, probabilities: { a: 0.8, b: 0.2 } },
  }, usage: { input_tokens: 10, output_tokens: 0 } };
  const client = new Clef({ accountId: "test-account", apiKey: "test-only", fetch: async () => Response.json(result) });
  assert.deepEqual(await client.askSplitting({}, {
    score: { type: "score", instructions: { ask: "severity" }, criteria: ["none", "minor", "major"] },
    choice: { type: "choice", instructions: { ask: "cause" }, criteria: { a: "one", b: "two" } },
  }), result);
});
