import { describe, it, expect, vi } from "vitest";
import { retry, backoffDelay, withTimeout, createHttpClient, createLimiter } from "../src/net";

const never = () => new Promise<never>(() => {});

describe("retry", () => {
  it("doubles the delay each attempt", () => {
    expect(backoffDelay(0)).toBe(100);
    expect(backoffDelay(1)).toBe(200);
    expect(backoffDelay(2)).toBe(400);
  });

  it("caps the delay at five seconds", () => {
    expect(backoffDelay(10)).toBe(5000);
  });

  it("adds jitter within ten percent", () => {
    const d = backoffDelay(3, { jitter: true });
    expect(d).toBeGreaterThanOrEqual(720);
    expect(d).toBeLessThanOrEqual(880);
  });
});

describe("HttpClient", () => {
  it("retries a 503 once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const client = createHttpClient({ fetch: fetchMock, retries: 1 });
    const res = await client.get("/health");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    const client = createHttpClient({ fetch: fetchMock, retries: 3 });
    await expect(client.get("/x")).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the base headers on every request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    const client = createHttpClient({ fetch: fetchMock, headers: { "x-api-key": "k" } });
    await client.get("/a");
    await client.post("/b", {});
    for (const call of fetchMock.mock.calls) {
      expect(call[1].headers["x-api-key"]).toBe("k");
    }
  });
});

describe("rate limiting", () => {
  it("refuses the third call within the window", () => {
    const limiter = createLimiter({ max: 2, windowMs: 1000 });
    expect(limiter.tryAcquire("k")).toBe(true);
    expect(limiter.tryAcquire("k")).toBe(true);
    expect(limiter.tryAcquire("k")).toBe(false);
  });

  it("counts keys separately", () => {
    const limiter = createLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.tryAcquire("a")).toBe(true);
    expect(limiter.tryAcquire("b")).toBe(true);
  });

  it("admits again after the window", () => {
    vi.useFakeTimers();
    const limiter = createLimiter({ max: 1, windowMs: 1000 });
    limiter.tryAcquire("k");
    vi.advanceTimersByTime(1001);
    expect(limiter.tryAcquire("k")).toBe(true);
    vi.useRealTimers();
  });
});

describe.skip("withTimeout", () => {
  it("rejects after the deadline", async () => {
    await expect(withTimeout(never(), 10)).rejects.toThrow(/timed out/);
  });

  it("resolves a fast promise unchanged", async () => {
    await expect(withTimeout(Promise.resolve(1), 10)).resolves.toBe(1);
  });
});

describe("retry with an abort signal", () => {
  it("stops retrying once the signal aborts", async () => {
    const ctrl = new AbortController();
    const fn = vi.fn().mockRejectedValue(new Error("nope"));
    const p = retry(fn, { retries: 5, signal: ctrl.signal, delay: () => 0 });
    ctrl.abort();
    await expect(p).rejects.toThrow(/abort/);
    expect(fn.mock.calls.length).toBeLessThan(6);
  });
});
