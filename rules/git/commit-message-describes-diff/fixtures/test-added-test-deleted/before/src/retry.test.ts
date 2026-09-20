import { describe, expect, it, vi } from "vitest";
import { retry } from "./retry.ts";

const noSleep = () => Promise.resolve();

describe("retry", () => {
  it("returns the first successful result", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("flaky")).mockResolvedValue("ok");
    await expect(retry(fn, { maxAttempts: 3, baseDelayMs: 1, sleep: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxAttempts and rethrows the last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("down"));
    await expect(retry(fn, { maxAttempts: 3, baseDelayMs: 1, sleep: noSleep })).rejects.toThrow("down");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops when the signal is aborted between attempts", async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockImplementation(async () => {
      controller.abort();
      throw new Error("first");
    });
    await expect(
      retry(fn, { maxAttempts: 5, baseDelayMs: 1, signal: controller.signal, sleep: noSleep }),
    ).rejects.toThrow("first");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
