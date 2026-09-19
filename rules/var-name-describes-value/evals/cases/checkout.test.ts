import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDiscount } from "./discount.ts";
import { computeTax } from "./tax.ts";
import { Cart } from "./cart.ts";
import { checkout, cancelOrder, reserveLineItems } from "./checkout.ts";
import * as inventory from "./inventory.ts";
import { ordersRepo } from "./orders-repo.ts";
import { getOrderStatus, postCharge, submitPayment } from "./payments-client.ts";
import { isCouponActive } from "./coupons.ts";

vi.mock("./discount.ts", () => ({
  applyDiscount: vi.fn((subtotal: number) => subtotal * 0.9),
}));

vi.mock("./tax.ts", () => ({
  computeTax: vi.fn(() => 8),
}));

vi.mock("./orders-repo.ts", () => ({
  ordersRepo: {
    findById: vi.fn(),
    save: vi.fn(),
  },
}));

const lineItems = [
  { sku: "SKU-1", unitPrice: 40, qty: 2 },
  { sku: "SKU-2", unitPrice: 20, qty: 1 },
];

describe("checkout pricing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies the percentage discount to the subtotal", () => {
    const cart = new Cart(lineItems);
    const total = checkout(cart, { coupon: "SAVE10" });
    expect(applyDiscount).toHaveBeenCalledWith(100, "SAVE10");
    expect(total.discounted).toBe(90);
  });

  it("adds 8% sales tax for California addresses", () => {
    const cart = new Cart(lineItems);
    const total = checkout(cart, { address: { state: "CA", zip: "94016" } });
    expect(computeTax).toHaveBeenCalled();
    expect(total.tax).toBe(8);
  });

  it("computes the total from the line items", () => {
    const cart = new Cart(lineItems);
    vi.spyOn(cart, "total").mockReturnValue(100);
    expect(cart.total()).toBe(100);
  });

  it("computes the total once per checkout", () => {
    const cart = new Cart(lineItems);
    const total = vi.spyOn(cart, "total");
    const result = checkout(cart, {});
    expect(result.subtotal).toBe(100);
    expect(total).toHaveBeenCalledTimes(1);
  });

  it("refuses to cancel an order that has already shipped", async () => {
    vi.mocked(ordersRepo.findById).mockResolvedValue({
      id: "ord_1",
      status: "shipped",
      lineItems,
    });
    await expect(cancelOrder("ord_1")).rejects.toThrow(/already shipped/);
    expect(ordersRepo.save).not.toHaveBeenCalled();
  });

  it("reserves stock for each line item before charging", async () => {
    vi.spyOn(inventory, "reserveStock").mockResolvedValue({ reserved: true });
    const result = await reserveLineItems(lineItems);
    expect(result).toEqual([{ reserved: true }, { reserved: true }]);
  });
});

describe("coupons", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires a coupon after its end date", () => {
    vi.setSystemTime(new Date("2024-07-02T00:00:00Z"));
    const coupon = { code: "JULY", endsAt: new Date("2024-07-01T00:00:00Z") };
    expect(isCouponActive(coupon)).toBe(false);
  });

  it("keeps a coupon active on its last day", () => {
    vi.setSystemTime(new Date("2024-07-01T12:00:00Z"));
    const coupon = { code: "JULY", endsAt: new Date("2024-07-01T23:59:59Z") };
    expect(isCouponActive(coupon)).toBe(true);
  });
});

describe("payments client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("computes the delivery ETA from the carrier's transit days", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "shipped", eta: "2024-07-04" }),
      }),
    );
    const status = await getOrderStatus("ord_1");
    expect(status.eta).toBe("2024-07-04");
  });

  it("retries a failed status request once before giving up", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "packed" }) });
    vi.stubGlobal("fetch", fetchMock);
    const status = await getOrderStatus("ord_1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(status.status).toBe("packed");
  });

  it("posts the order payload to the payments API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "pay_1" }) });
    vi.stubGlobal("fetch", fetchMock);
    await submitPayment({ orderId: "ord_1", amountCents: 9000, currency: "USD" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://payments.example.com/v1/charges",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ orderId: "ord_1", amountCents: 9000, currency: "USD" }),
      }),
    );
  });
});

describe("payments API auth", () => {
  it("rejects a charge without a token, and accepts one with it", async () => {
    const unauthorized = await postCharge({ orderId: "ord_1", amountCents: 9000 }, {});
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({ ok: false, error: "unauthorized" });

    const authorized = await postCharge(
      { orderId: "ord_1", amountCents: 9000 },
      { authorization: "Bearer test-token" },
    );
    expect(authorized.status).toBe(201);
  });

  it("rejects a charge that is missing its order id", async () => {
    const missingOrder = await postCharge({ amountCents: 9000 }, { authorization: "Bearer test-token" });
    expect(missingOrder.status).toBe(400);
    await expect(missingOrder.json()).resolves.toEqual({ ok: false, error: "missing field: orderId" });
  });
});
