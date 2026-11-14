import { strict as assert } from "node:assert";
import { Jev } from "../src/jev.ts";
import { testAsync } from "./harness.ts";

const questions = { q: { type: "noul" as const, instructions: {}, criteria: { true: "yes", false: "no" } } };

await testAsync("request-control: consent is checked again for every outbound request", async () => {
  let permitted = true, sent = 0, checked = 0;
  const client = new Jev({ apiKey: "test", beforeSend: async () => { checked++; if (!permitted) throw new Error("withdrawn"); },
    fetch: async () => { sent++; return Response.json({ answers: { q: { type: "noul", noul: 0.1 } } }); } });
  await client.ask({}, questions);
  permitted = false;
  await assert.rejects(client.ask({}, questions), /withdrawn/);
  assert.equal(sent, 1);
  assert.equal(checked, 2);
});

await testAsync("request-control: concurrent requests cannot overspend the request budget", async () => {
  let sent = 0;
  const client = new Jev({ apiKey: "test", budget: { maxRequests: 1 }, fetch: async () => { sent++; return Response.json({ answers: {} }); } });
  const outcomes = await Promise.allSettled([client.ask({}, questions), client.ask({}, questions)]);
  assert.equal(outcomes.filter((o) => o.status === "rejected").length, 1);
  assert.equal(sent, 1);
});

await testAsync("request-control: cancellation and an exhausted token or cost budget prevent sending", async () => {
  for (const options of [{ signal: AbortSignal.abort() }, { budget: { maxInputTokens: 0 } }, { budget: { maxUsd: 0 } }, { budget: { maxMs: 0 } }]) {
    let sent = false;
    const client = new Jev({ apiKey: "test", ...options, fetch: async () => { sent = true; return Response.json({}); } });
    await assert.rejects(client.ask({}, questions));
    assert.equal(sent, false);
  }
});

await testAsync("request-control: cancellation during backoff prevents another request", async () => {
  const controller = new AbortController();
  let sent = 0, checked = 0;
  const client = new Jev({ apiKey: "test", signal: controller.signal, beforeSend: async () => { checked++; }, fetch: async () => {
    sent++; controller.abort(); return new Response("retry", { status: 500 });
  } });
  await assert.rejects(client.ask({}, questions));
  assert.equal(sent, 1);
  assert.equal(checked, 1);
});

await testAsync("request-control: a retry must obtain fresh authorization before sending again", async () => {
  let checked = 0, sent = 0;
  const client = new Jev({ apiKey: "test", retries: 1, beforeSend: async () => { if (++checked > 1) throw new Error("withdrawn"); },
    fetch: async () => { sent++; return new Response("retry", { status: 500, headers: { "retry-after": "0" } }); } });
  await assert.rejects(client.ask({}, questions), /withdrawn/);
  assert.equal(checked, 2);
  assert.equal(sent, 1);
});

await testAsync("request-control: actual token usage retires remaining budget before another request", async () => {
  let sent = 0;
  const client = new Jev({ apiKey: "test", budget: { maxInputTokens: 1000 }, fetch: async () => {
    sent++; return Response.json({ answers: {}, usage: { input_tokens: 1500 } });
  } });
  await client.ask({}, questions);
  await assert.rejects(client.ask({}, questions), /budget/);
  assert.equal(sent, 1);
});

await testAsync("request-control: malformed token usage cannot free budget or fabricate spend", async () => {
  for (const input_tokens of [-1, 1.5, "0", Infinity]) {
    const client = new Jev({ apiKey: "test", fetch: async () => Response.json({ answers: {}, usage: { input_tokens } }) });
    await assert.rejects(client.ask({}, questions), /usage/);
  }
});
