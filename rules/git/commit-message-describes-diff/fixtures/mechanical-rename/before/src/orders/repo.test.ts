import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryDb } from "../db.ts";
import { insertOrder, ordersFor } from "./repo.ts";

describe("orders repo", () => {
  let db: Awaited<ReturnType<typeof openMemoryDb>>;
  beforeEach(async () => {
    db = await openMemoryDb();
  });

  it("lists a customer's orders newest first", async () => {
    await insertOrder(db, { id: "o1", customerId: "c1", totalCents: 100, placedAt: "2026-01-01T00:00:00Z" });
    await insertOrder(db, { id: "o2", customerId: "c1", totalCents: 200, placedAt: "2026-01-02T00:00:00Z" });
    await insertOrder(db, { id: "o3", customerId: "c2", totalCents: 300, placedAt: "2026-01-03T00:00:00Z" });
    const orders = await ordersFor(db, "c1");
    expect(orders.map((o) => o.id)).toEqual(["o2", "o1"]);
    expect(orders.every((o) => o.customerId === "c1")).toBe(true);
  });
});
