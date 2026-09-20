import { describe, expect, it } from "vitest";
import { applyCoupon, cartTotal, checkoutCart, removeItem, type Cart } from "./basket";

const twoLines: Cart = {
  id: "c1",
  lines: [
    { sku: "mug", qty: 2, unitCents: 1200 },
    { sku: "tee", qty: 1, unitCents: 2500 },
  ],
};

function withEmptyCart(): Cart {
  return { id: "c-empty", lines: [] };
}

describe("cartTotal", () => {
  it("sums qty times unit price across lines", () => {
    expect(cartTotal(twoLines)).toBe(4900);
  });

  it("is zero for an empty cart", () => {
    expect(cartTotal(withEmptyCart())).toBe(0);
  });
});

describe("applyCoupon", () => {
  it("discounts every line by the coupon's percentage", () => {
    const coupon = { code: "TEN", percentOff: 10, expiresAt: 2000 };
    const discounted = applyCoupon(twoLines, coupon, 1000);
    expect(discounted.lines.map((l) => l.unitCents)).toEqual([1080, 2250]);
  });

  it("records the coupon code on the cart", () => {
    const coupon = { code: "TEN", percentOff: 10, expiresAt: 2000 };
    expect(applyCoupon(twoLines, coupon, 1000).couponCode).toBe("TEN");
  });
});

describe("removeItem", () => {
  it("drops the line with the given sku", () => {
    const after = removeItem(twoLines, "mug");
    expect(after.lines.map((l) => l.sku)).toEqual(["tee"]);
  });

  it("throws when the sku is not in the cart", () => {
    expect(() => removeItem(twoLines, "hat")).toThrow(/not in cart/);
  });
});

describe("checkoutCart", () => {
  it("returns an order id derived from the cart id and the total", () => {
    expect(checkoutCart(twoLines)).toEqual({ orderId: "order-c1", totalCents: 4900 });
  });

  it("refuses an empty cart", () => {
    expect(() => checkoutCart(withEmptyCart())).toThrow();
  });
});
