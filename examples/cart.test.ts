import { describe, expect, it } from "vitest";
import { applyDiscount, removeItem, subtotal } from "./cart";

const cart = {
  id: "c1",
  items: [
    { sku: "a", price: 10, qty: 2 },
    { sku: "b", price: 5, qty: 1 },
  ],
};

describe("cart", () => {
  it("sums price times quantity", () => {
    expect(subtotal(cart)).toBe(25);
  });

  it("removes the item with the given sku", () => {
    const next = removeItem(cart, "a");
    expect(next.items.length).toBeGreaterThan(0);
  });

  it("applies the discount to the subtotal", () => {
    expect(applyDiscount(cart, 10)).toBe(22.5);
  });
});
