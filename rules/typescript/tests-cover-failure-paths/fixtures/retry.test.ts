import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry, RetryExhausted, withTimeout } from "./retry";

const okResponse = { ok: true, status: 200 } as Response;
const failing = { ok: false, status: 503 } as Response;

describe("fetchWithRetry", () => {
  it("returns the first ok response", async () => {
    const doFetch = vi.fn().mockResolvedValueOnce(failing).mockResolvedValueOnce(okResponse);
    await expect(fetchWithRetry("https://api.example/x", 3, doFetch)).resolves.toBe(okResponse);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after the attempt budget", async () => {
    const doFetch = vi.fn().mockResolvedValue(failing);
    await expect(fetchWithRetry("https://api.example/x", 2, doFetch)).rejects.toBeInstanceOf(RetryExhausted);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });
});

describe("withTimeout", () => {
  it("resolves with the inner value when it settles in time", async () => {
    await expect(withTimeout(Promise.resolve(42), 50)).resolves.toBe(42);
  });

  it("rejects with TimeoutError when the timer fires first", async () => {
    const never = new Promise<number>(() => undefined);
    let caught: unknown;
    try {
      await withTimeout(never, 5);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("TimeoutError");
  });
});
