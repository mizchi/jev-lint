import { strict as assert } from "node:assert";
import { OpenRouter } from "../src/openrouter.ts";
import { JevError } from "../src/jev.ts";
import { readAnswer, readChoice } from "../src/questions.ts";
import { testAsync } from "./harness.ts";
import type { Question } from "../src/types.ts";

const questions = {
  n: { type: "noul", instructions: { ask: "The name contradicts the body." }, criteria: { true: "Contradiction.", false: "Consistent." } },
  c: { type: "choice", instructions: { ask: "Choose a starter." }, criteria: { enable: "Enable.", defer: "Defer." } },
  s: { type: "score", instructions: { ask: "Count." }, criteria: ["None.", "One.", "Two."] },
} satisfies Record<string, Question>;
function response(cost = 0.001) {
  return { model: "liquid/d1.2-ultra-20261116", answers: { n: { type: "noul", noul: 0.9 }, c: { type: "choice", choice: "enable", confidence: 1, probabilities: { enable: 1, defer: 0 } }, s: { type: "score", score: 2 } }, usage: { input_tokens: 100, output_tokens: 0, cost } };
}

await testAsync("openrouter: native endpoint preserves typed questions and accounts for actual billed cost", async () => {
  const state = { source: "function pure() { write(); }" };
  const client = new OpenRouter({ model: "liquid/d1.2-ultra", apiKey: "fixture", retries: 0,
    fetch: async (url, init) => {
      assert.equal(url, "https://openrouter.ai/api/alpha/decisions");
      assert.deepEqual(JSON.parse(String(init?.body)), { model: "liquid/d1.2-ultra", state, questions });
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture");
      return Response.json(response());
    },
  });
  const result = await client.askSplitting(state, questions);
  assert.equal(readAnswer(result.answers, "n", "noul")?.value, 0.9);
  assert.equal(readChoice(result.answers, "c", ["enable", "defer"])?.choice, "enable");
  assert.equal(readAnswer(result.answers, "s", "score")?.value, 2);
  assert.equal(client.spent.usd, 0.001); assert.equal(client.spent.inputTokens, 100);
});

await testAsync("openrouter: empty or absent credentials never send requests", async () => {
  const client = new OpenRouter({ model: "liquid/d1.2-ultra", apiKey: "", fetch: async () => { throw new Error("must not send"); } });
  assert.deepEqual((await client.askSplitting({}, {})).answers, {});
  await assert.rejects(() => client.askSplitting({}, questions), (error: unknown) => error instanceof JevError && error.kind === "auth" && /OPENROUTER_API_KEY/.test(error.message));
  assert.equal(client.spent.calls, 0);
});

await testAsync("openrouter: malformed replies and costs cannot become successful decisions", async () => {
  const original = response();
  for (const value of [null, { ...original, answers: [] }, { ...original, usage: {} }, ...[null, -1, "0", Infinity].map((cost) => ({ ...original, usage: { ...original.usage, cost } }))]) {
    const client = new OpenRouter({ apiKey: "fixture", retries: 0, fetch: async () => Response.json(value) });
    await assert.rejects(() => client.askSplitting({}, questions), /invalid/);
  }
  const free = new OpenRouter({ model: "perplexity/pplx-decider-v1.3:free", requestIntervalMs: 0, apiKey: "fixture", fetch: async () => Response.json(response(0)) });
  await free.askSplitting({}, questions); assert.equal(free.spent.usd, 0);
});

await testAsync("openrouter: question splitting preserves state and IDs while adding actual request costs", async () => {
  const sizes: number[] = [], all = Object.fromEntries(Array.from({ length: 130 }, (_, i) => [`q${i}`, questions.n]));
  const state = { source: "context" };
  const client = new OpenRouter({ apiKey: "fixture", fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); assert.deepEqual(body.state, state);
    sizes.push(Object.keys(body.questions).length);
    return Response.json({ ...response(0.001), answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { type: "noul", noul: 0.1 }])) });
  } });
  const result = await client.askSplitting(state, all);
  assert.deepEqual(Object.keys(result.answers!), Object.keys(all)); assert.deepEqual(sizes, [65, 65]);
  assert.equal(client.spent.usd, 0.002);
});

await testAsync("openrouter: oversized multibyte state is refused before sending rather than silently truncated", async () => {
  const client = new OpenRouter({ apiKey: "fixture", fetch: async () => { throw new Error("must not send"); } });
  await assert.rejects(() => client.askSplitting({ source: "あ".repeat(40_000) }, { q0000: questions.n }), /context guard/);
  assert.equal(client.spent.calls, 0);
});

await testAsync("openrouter: a different provider's key cannot authorize native requests", async () => {
  const previous = process.env.OPENROUTER_API_KEY, other = process.env.TYPESAFE_API_KEY;
  try {
    delete process.env.OPENROUTER_API_KEY; process.env.TYPESAFE_API_KEY = "different-provider-fixture";
    const client = new OpenRouter({ fetch: async () => { throw new Error("must not send"); } });
    await assert.rejects(() => client.askSplitting({}, questions), /OPENROUTER_API_KEY/);
    assert.equal(client.spent.calls, 0);
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous;
    if (other === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = other;
  }
});

await testAsync("openrouter: request budgets settle the actual provider charge rather than a nominal input price", async () => {
  let calls = 0;
  const client = new OpenRouter({ apiKey: "fixture", retries: 0, budget: { maxUsd: 0.0009 }, fetch: async () => { calls++; return Response.json(response(0.001)); } });
  await client.askSplitting({}, { n: questions.n });
  await assert.rejects(() => client.askSplitting({}, { n: questions.n }), /budget/);
  assert.equal(calls, 1); assert.equal(client.spent.usd, 0.001);
});

await testAsync("openrouter: local rate-limit waiting does not consume the individual network timeout", async () => {
  const client = new OpenRouter({ apiKey: "fixture", retries: 0, requestIntervalMs: 35, timeoutMs: 10, fetch: async () => Response.json(response()) });
  const answers = await Promise.all([client.askSplitting({}, { n: questions.n }), client.askSplitting({}, { n: questions.n })]);
  assert.equal(answers.length, 2); assert.equal(client.spent.calls, 2);
});

await testAsync("openrouter: retries honor native pacing and queued requests honor cancellation", async () => {
  const times: number[] = [];
  const client = new OpenRouter({ apiKey: "fixture", requestIntervalMs: 40, timeoutMs: 10, fetch: async () => {
    times.push(Date.now());
    return times.length === 1 ? new Response("busy", { status: 429, headers: { "retry-after": "0" } }) : Response.json(response());
  } });
  await client.askSplitting({}, { n: questions.n });
  assert(times[1]! - times[0]! >= 30, `retry spacing: ${times[1]! - times[0]!}ms`);
  const controller = new AbortController(); let calls = 0;
  const cancelled = new OpenRouter({ apiKey: "fixture", requestIntervalMs: 1000, signal: controller.signal, fetch: async () => { calls++; return Response.json(response()); } });
  await cancelled.askSplitting({}, { n: questions.n });
  const waiting = cancelled.askSplitting({}, { n: questions.n }); controller.abort();
  await assert.rejects(() => waiting, /abort/i); assert.equal(calls, 1);
});
