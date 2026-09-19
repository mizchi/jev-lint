import assert from "node:assert/strict";
import { test, vi, jest } from "./harness";
import { collectFetchRuns, type CollectDeps } from "./collector";
import { reviewHubPrs } from "./hub-pr-review";
import { queueWorker } from "./worker";
import { makeJsonResponse, makeHubPrRaw, type JsonObject } from "./fixtures";

test("worker retries the agent call once after a transient upstream failure", async () => {
  const sent: string[] = [];
  const env = makeEnv({ onSend: (body) => sent.push(body) });
  await queueWorker.submit({ job_id: "job-1", prompt: "fix the build" }, env);
  assert.equal(sent.length, 1);

  let agentCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url !== "https://agent.example/run") {
      return makeJsonResponse({ ok: false, error: "not found" }, 404);
    }
    agentCalls += 1;
    if (agentCalls === 1) {
      return makeJsonResponse({ ok: true, output: "invalid output" }, 200);
    }
    if (agentCalls === 2) {
      throw new Error("temporary upstream failure");
    }
    return makeJsonResponse({ ok: true, output: JSON.stringify({ files: [] }) }, 200);
  };

  const retried: string[] = [];
  try {
    await queueWorker.queue({ messages: [{ body: sent[0], retry: () => retried.push("retry") }] }, env);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert(retried.length > 0, "message must be retried at most once");
  assert.equal(agentCalls, 3);
});

test("collector retries a fetch page after a network failure", async () => {
  let fetchAttempts = 0;
  const deps: CollectDeps = {
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname !== "/api/v1/bit/fetch") {
        return makeJsonResponse({ ok: false, error: "unexpected route" }, 404);
      }
      fetchAttempts += 1;
      if (fetchAttempts === 1) {
        throw new Error("temporary network failure");
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as JsonObject;
      const after = Number(body.after ?? 0);
      return makeJsonResponse({ ok: true, next_cursor: after + 1, objects: [] });
    },
  };
  const result = await collectFetchRuns({ baseUrl: "https://cluster.example", fetchRetries: 1 }, deps);
  assert.equal(result.ok, true);
  assert.equal(fetchAttempts, 2);
});

test("review falls back to a single-item page when the list request is aborted", async () => {
  const result = await reviewHubPrs(
    { baseUrl: "https://cluster.example", objectiveIds: ["obj-1"], prLimit: 5 },
    {
      fetchImpl: async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("/api/v1/bit/hub/prs?") && url.includes("objective_id=obj-1") && url.includes("limit=5")) {
          throw new Error("This operation was aborted");
        }
        if (url.includes("/api/v1/bit/hub/prs?") && url.includes("limit=1")) {
          return makeJsonResponse({ ok: true, prs: [makeHubPrRaw({ pr_id: "hpr-fallback" })], next_cursor: 0 });
        }
        if (url.includes("/api/v1/bit/hub/prs/hpr-fallback/events")) {
          return makeJsonResponse({ ok: true, events: [], returned_count: 0 });
        }
        return makeJsonResponse({ ok: false, error: `unexpected route: ${url}` }, 404);
      },
      nowMs: () => Date.parse("2026-02-16T01:00:00.000Z"),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.prs[0]?.pr_id, "hpr-fallback");
});

test("store reconnects after the first write is reset by the peer", async () => {
  let writes = 0;
  const write = vi.fn().mockImplementation(async (key: string, value: string) => {
    writes += 1;
    if (writes === 1) {
      throw new Error("ECONNRESET: connection reset by peer");
    }
    return { key, value, version: writes };
  });
  const store = makeStore({ write });
  const saved = await store.put("run:1", "{}");
  assert.equal(saved.version, 2);
  assert.equal(write.mock.calls.length, 2);
});

test("scheduler skips a job whose lease cannot be read", async () => {
  const readLease = jest.fn(async (jobId: string) => {
    if (jobId === "job-locked") {
      throw new Error("EACCES: permission denied, open '/var/leases/job-locked'");
    }
    return { jobId, holder: null };
  });
  const scheduler = makeScheduler({ readLease });
  const picked = await scheduler.pick(["job-locked", "job-free"]);
  assert.deepEqual(picked, ["job-free"]);
});

class FakeQueue {
  public readonly sent: string[] = [];
  send(body: string): void {
    if (body.includes("poison")) {
      throw new Error("queue rejected message: payload too large");
    }
    this.sent.push(body);
  }
}

test("worker parks a message the queue rejects and continues with the rest", async () => {
  const queue = new FakeQueue();
  const parked: string[] = [];
  await queueWorker.drain(["a", "poison-b", "c"], { queue, park: (b) => parked.push(b) });
  assert.deepEqual(queue.sent, ["a", "c"]);
  assert.deepEqual(parked, ["poison-b"]);
});

test("cli reports a payload file it cannot open and exits non-zero", async () => {
  const stderr: string[] = [];
  const runtime = {
    readFileText: async (path: string): Promise<string> => {
      if (path.endsWith(".lock")) {
        throw new Error("EBUSY: resource busy or locked");
      }
      return '{"prompt":"hello"}';
    },
    writeStderr: (line: string) => stderr.push(line),
  };
  const code = await runCli(["submit", "--payload-file", "payload.lock"], runtime);
  assert.equal(code, 1);
  assert.match(stderr.join("\n"), /EBUSY/);
});

function makeEnv(opts: { onSend: (body: string) => void }): JsonObject {
  return { QUEUE: { send: opts.onSend } } as unknown as JsonObject;
}
declare function makeStore(deps: { write: (key: string, value: string) => Promise<unknown> }): { put(k: string, v: string): Promise<{ version: number }> };
declare function runCli(argv: string[], runtime: { readFileText: (p: string) => Promise<string>; writeStderr: (l: string) => void }): Promise<number>;
declare function makeScheduler(deps: { readLease: (jobId: string) => Promise<unknown> }): { pick(ids: string[]): Promise<string[]> };
