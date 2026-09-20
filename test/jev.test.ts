import { strict as assert } from "node:assert";
import { Jev, JevError, Pacer, API_KEY_VARS, DEFAULT_BASE_URL, fromEnv } from "../src/jev.ts";
import { questionId } from "../src/questions.ts";
import type { Question } from "../src/types.ts";
import { test, testAsync, configurable } from "./helpers.ts";

await testAsync("jev: no API key is an auth error, not a crash mid-run", async () => {
  const jev = new Jev({ apiKey: "" });
  await assert.rejects(
    () =>
      jev.ask({}, {
        q0000: { type: "noul", instructions: {}, criteria: { true: "y", false: "n" } },
      }),
    (err: unknown) => {
      assert.ok(err instanceof JevError);
      assert.equal((err as JevError).kind, "auth");
      return true;
    },
  );
});

test("jev: a billing refusal is an auth error, since retrying will not help", () => {
  // 402 came back on every one of 69 requests in a run -- 23 batches times 3
  // passes -- because it was classified `other`, and `other` is per batch.
  assert.equal(Jev.classify(402, ""), "auth");
  assert.equal(Jev.classify(401, ""), "auth");
  assert.equal(Jev.classify(403, ""), "auth");
  assert.equal(Jev.classify(400, "max_tokens_exceeded"), "too_big");
  assert.equal(Jev.classify(400, "bad json"), "other");
  assert.equal(Jev.classify(500, ""), "other");
});

await testAsync("jev: an empty question set costs nothing and makes no request", async () => {
  let called = false;
  const jev = new Jev({ apiKey: "k", onRequest: () => (called = true) });
  const res = await jev.ask({}, {});
  assert.deepEqual(res.answers, {});
  assert.equal(called, false);
  assert.equal(jev.calls, 0);
});

await testAsync("jev: a too-big request is halved until it fits, and answers merge", async () => {
  const jev = new Jev({ apiKey: "k", retries: 0 });
  const seen: string[][] = [];
  let calls = 0;
  jev.ask = async (_state: unknown, questions: Record<string, Question>) => {
    calls += 1;
    const names = Object.keys(questions);
    // A stand-in server whose limit is two questions: over it, it answers
    // as the real one does to a request over its token limit.
    // jev-lint-ignore-next-line error-message-matches-condition
    if (names.length > 2) {
      throw new JevError("max_tokens_exceeded", { status: 400, kind: "too_big" });
    }
    seen.push(names);
    return {
      answers: Object.fromEntries(names.map((n) => [n, { type: "noul", noul: 0.5 }])),
      usage: { input_tokens: 10 },
    };
  };
  const questions = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [
      questionId(i),
      { type: "noul", instructions: {}, criteria: { true: "y", false: "n" } },
    ]),
  ) as Record<string, Question>;
  const res = await jev.askSplitting({}, questions);
  assert.equal(Object.keys(res.answers!).length, 8, "every question must come back");
  assert.equal(res.usage!.input_tokens, 40);
  assert.ok(seen.every((s) => s.length <= 2));
  assert.ok(calls > 1);
});

await testAsync("jev: a single question that is still too big is not retried forever", async () => {
  const jev = new Jev({ apiKey: "k" });
  jev.ask = async () => {
    throw new JevError("max_tokens_exceeded", { status: 400, kind: "too_big" });
  };
  await assert.rejects(
    () =>
      jev.askSplitting({}, {
        q0000: { type: "noul", instructions: {}, criteria: { true: "y", false: "n" } },
      }),
    /max_tokens_exceeded/,
  );
});

await testAsync("jev: a 429 is waited out at a lower rate and the request goes again, not lost", async () => {
  // The server rate-limits with a bare 429 -- no retry-after, no ratelimit
  // headers -- on input tokens, not requests. The client mirrors the bucket
  // and paces itself; a 429 means the mirror was optimistic: it empties,
  // the rate drops, and the request that met it waits and goes again. It is
  // not a failure of the request and does not spend the retry budget.
  const pacer = new Pacer(1_000_000, 1_000_000);
  const jev = new Jev({ apiKey: "k", retries: 0, pacer, fetch: fakeFetch, rateLimitWaitMs: 1 });
  let calls = 0;
  async function fakeFetch(): Promise<Response> {
    calls += 1;
    if (calls <= 3) {
      return new Response('{"detail":{"error_type":"api_usage_error","message":"Rate limit exceeded."}}', { status: 429 });
    }
    return new Response(JSON.stringify({ answers: { q0000: { type: "noul", noul: 0.5 } }, usage: { input_tokens: 1 } }), { status: 200 });
  }
  const q = { q0000: { type: "noul", instructions: {}, criteria: { true: "y", false: "n" } } } as Record<string, Question>;
  const res = await jev.askSplitting({}, q);
  assert.ok(res.answers?.q0000, "the verdict came back after the 429s");
  assert.equal(jev.rateLimited, 3, "each refusal is counted");
  assert.equal(jev.retried, 0, "a 429 does not spend the retry budget");
  assert.ok(pacer.rate < 1_000_000 * 0.75 ** 2, `the rate dropped a quarter per 429, got ${pacer.rate}`);
  assert.ok(pacer.available() < 500_000, "the mirror was emptied and has only begun to refill");
});

test("jev: the pacer charges the estimate, refills at its rate, and makes a request wait", () => {
  const t0 = 1_000_000;
  const pacer = new Pacer(100_000, 300_000, t0);
  assert.equal(pacer.delay(250_000, t0), 0, "within the burst: no wait");
  assert.equal(pacer.delay(300_000, t0), 0);
  assert.equal(pacer.delay(2_000_000, t0), 0, "a request larger than the burst goes when the bucket is full, not never");
  // Charge 250k: 50k left; 100k more is 500 ms away at 100k/s.
  pacer.settle(0, 250_000);
  assert.equal(pacer.delay(100_000, t0), 500);
  assert.equal(pacer.delay(100_000, t0 + 500), 0);
  assert.equal(pacer.delay(100_000, t0 + 250), 250);
  // The server counted more than the estimate: the difference is charged.
  pacer.settle(1_000, 21_000);
  assert.equal(pacer.delay(100_000, t0 + 500), 200);
  // A 429 empties the mirror and slows the refill.
  pacer.throttled(t0 + 500);
  assert.equal(pacer.rate, 75_000);
  assert.equal(pacer.available(t0 + 500), 0);
  assert.equal(pacer.delay(75_000, t0 + 500), 1000);
});

await testAsync("jev: a 429 that never clears is given up on, with the server's message", async () => {
  const jev = new Jev({ apiKey: "k", retries: 0, fetch: always429, rateLimitWaitMs: 1, rateLimitRetries: 3 });
  let calls = 0;
  async function always429(): Promise<Response> {
    calls += 1;
    return new Response('{"detail":{"message":"Rate limit exceeded."}}', { status: 429 });
  }
  const q = { q0000: { type: "noul", instructions: {}, criteria: { true: "y", false: "n" } } } as Record<string, Question>;
  await assert.rejects(() => jev.ask({}, q), /HTTP 429/);
  assert.equal(calls, 4, "one attempt plus rateLimitRetries");
});

await testAsync("jev: usage is priced at the published input rate", async () => {
  const jev = new Jev({ apiKey: "k" });
  jev.inputTokens = 1_000_000;
  assert.ok(Math.abs(jev.usd - 0.042) < 1e-9);
});

test("jev: the key and the endpoint prefer TYPESAFE_ and fall back to TYPESAFEAI_", () => {
  // The prevailing spelling wins, and an environment that only has the older
  // name keeps working -- an existing setup should not become a config error.
  assert.deepEqual(API_KEY_VARS, ["TYPESAFE_API_KEY", "TYPESAFEAI_API_KEY"]);
  assert.equal(fromEnv(API_KEY_VARS, { TYPESAFEAI_API_KEY: "old" }), "old");
  assert.equal(fromEnv(API_KEY_VARS, { TYPESAFE_API_KEY: "new", TYPESAFEAI_API_KEY: "old" }), "new");
  assert.equal(fromEnv(API_KEY_VARS, { TYPESAFE_API_KEY: "   ", TYPESAFEAI_API_KEY: "old" }), "old",
    "blank is not set");
  assert.equal(fromEnv(API_KEY_VARS, {}), null);
});

test("jev: the endpoint is configurable and a trailing slash does not double up", () => {
  assert.equal(new Jev({ apiKey: "k" }).baseUrl, DEFAULT_BASE_URL);
  assert.equal(new Jev({ apiKey: "k", baseUrl: "https://proxy.example/v1/" }).baseUrl,
    "https://proxy.example/v1", "or the request path would contain //");
});
