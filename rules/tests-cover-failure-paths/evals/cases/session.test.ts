import { describe, expect, it, vi } from "vitest";
import { isExpired, loadSession, touchSession, type Session, type SessionStore } from "./session";

const alice: Session = { id: "s1", userId: "alice", lastSeenAt: 100, expiresAt: 1100 };

function storeWith(session: Session): SessionStore {
  return {
    get: vi.fn(async () => session),
    put: vi.fn(async () => undefined),
  };
}

describe("loadSession", () => {
  it("returns the stored session for its id", async () => {
    const store = storeWith(alice);
    await expect(loadSession(store, "s1")).resolves.toEqual(alice);
    expect(store.get).toHaveBeenCalledWith("s1");
  });
});

describe("touchSession", () => {
  it("moves lastSeenAt to now and pushes expiry out by the ttl", () => {
    const touched = touchSession(alice, 500, 1000);
    expect(touched.lastSeenAt).toBe(500);
    expect(touched.expiresAt).toBe(1500);
  });
});

describe("isExpired", () => {
  it("is true once now reaches expiresAt", () => {
    expect(isExpired(alice, 1100)).toBe(true);
    expect(isExpired(alice, 1099)).toBe(false);
  });
});
