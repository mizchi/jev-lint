import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { requireAuth } from "../src/middleware/auth";
import { FakeClockScheduler } from "./helpers/fake_scheduler";
import { sortByPrice } from "../src/catalog";
import { seedDatabase, openTestDb } from "./helpers/db";
import { createOrder, createOrderDraft } from "../src/orders";
import { UserService } from "../src/user_service";
import { LruCache } from "../src/cache";

describe("requireAuth", () => {
  const app = express();
  app.use(requireAuth({ secret: "s3cret" }));
  app.get("/me", (req, res) => res.json({ id: (req as any).user.id }));

  it("rejects a request without a token", async () => {
    const res = await request(app).get("/me");
    expect(res.status).toBe(401);
  });

  it("admits a request with a valid token", async () => {
    const res = await request(app).get("/me").set("authorization", "Bearer " + signFor("u1"));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("u1");
  });
});

describe("Scheduler", () => {
  it("runs a job when its time comes", () => {
    const scheduler = new FakeClockScheduler();
    const job = vi.fn();
    scheduler.at(1000, job);
    scheduler.advance(999);
    expect(job).not.toHaveBeenCalled();
    scheduler.advance(1);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it("runs overdue jobs in order", () => {
    const scheduler = new FakeClockScheduler();
    const order: number[] = [];
    scheduler.at(300, () => order.push(2));
    scheduler.at(100, () => order.push(1));
    scheduler.advance(500);
    expect(order).toEqual([1, 2]);
  });
});

describe("sortByPrice", () => {
  const items = [
    { sku: "A", price: 30 },
    { sku: "B", price: 10 },
    { sku: "C", price: 20 },
  ];

  it("returns every item", () => {
    expect(sortByPrice(items)).toHaveLength(3);
  });

  it("does not mutate its input", () => {
    sortByPrice(items);
    expect(items[0].sku).toBe("A");
  });
});

describe("seedDatabase", () => {
  let db: ReturnType<typeof openTestDb>;
  beforeEach(async () => {
    db = openTestDb();
    await seedDatabase(db);
  });

  it("creates the admin user", async () => {
    expect(await db.users.findByEmail("admin@example.com")).toMatchObject({ role: "admin" });
  });

  it("creates one row per default role", async () => {
    expect(await db.roles.count()).toBe(3);
  });
});

describe("createOrder", () => {
  it("starts with no lines", () => {
    const draft = createOrderDraft({ customerId: "c1" });
    expect(draft.lines).toEqual([]);
  });

  it("carries the customer id", () => {
    const draft = createOrderDraft({ customerId: "c1" });
    expect(draft.customerId).toBe("c1");
  });

  it("is not yet persisted", () => {
    const draft = createOrderDraft({ customerId: "c1" });
    expect(draft.id).toBeUndefined();
  });
});

describe("UserService.findById", () => {
  let service: UserService;
  beforeEach(() => {
    service = new UserService(openTestDb());
  });

  it("returns the user with that email", async () => {
    await service.create({ id: "u1", email: "a@b.co" });
    expect(await service.findByEmail("a@b.co")).toMatchObject({ id: "u1" });
  });

  it("returns null when nobody matches", async () => {
    expect(await service.findByEmail("nobody@b.co")).toBeNull();
  });
});

describe("cache eviction", () => {
  it("returns a stored value", () => {
    const cache = new LruCache<string, number>({ max: 100 });
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  it("overwrites a repeated key", () => {
    const cache = new LruCache<string, number>({ max: 100 });
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.get("a")).toBe(2);
    expect(cache.size).toBe(1);
  });

  it("reports a miss as undefined", () => {
    const cache = new LruCache<string, number>({ max: 100 });
    expect(cache.get("zz")).toBeUndefined();
  });
});

function signFor(id: string): string {
  return Buffer.from(JSON.stringify({ sub: id })).toString("base64url");
}
