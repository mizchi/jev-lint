import { describe, it, expect } from "vitest";
import { checkout, computeTotals, formatMoney, emptyCart, addItem, removeItem } from "../src/checkout";
import type { Line } from "../src/checkout";

function cartWith(lines: Line[]) {
  return lines.reduce((cart, line) => addItem(cart, line), emptyCart());
}

describe("discount codes", () => {
  it("applies a percentage code to the subtotal", () => {
    const receipt = checkout(cartWith([{ sku: "A", price: 100, qty: 2 }]), { code: "SAVE10" });
    expect(receipt.total).toBe(180);
  });

  it("ignores an expired code", () => {
    const receipt = checkout(cartWith([{ sku: "A", price: 100, qty: 1 }]), { code: "XMAS2019" });
    expect(receipt.total).toBe(100);
    expect(receipt.warnings).toContain("code expired");
  });

  it("applies a fixed code after the percentage one", () => {
    const receipt = checkout(cartWith([{ sku: "A", price: 100, qty: 1 }]), { code: "SAVE10+5OFF" });
    expect(receipt.total).toBe(85);
  });
});

describe("CartService", () => {
  it("sums line totals", () => {
    const totals = computeTotals([
      { sku: "A", price: 100, qty: 2 },
      { sku: "B", price: 50, qty: 1 },
    ]);
    expect(totals.subtotal).toBe(250);
  });

  it("applies tax after discount", () => {
    const totals = computeTotals([{ sku: "A", price: 100, qty: 1 }], { discount: 10, taxRate: 0.2 });
    expect(totals.total).toBe(108);
  });

  it("rounds to cents", () => {
    const totals = computeTotals([{ sku: "A", price: 33.333, qty: 1 }]);
    expect(totals.subtotal).toBe(33.33);
  });
});

describe("removeItem", () => {
  it("keeps the other lines", () => {
    const cart = addItem(emptyCart(), { sku: "A", price: 10, qty: 1 });
    const next = addItem(cart, { sku: "B", price: 10, qty: 1 });
    expect(next.lines).toHaveLength(2);
  });

  it("is a no-op on an empty cart", () => {
    expect(addItem(emptyCart(), { sku: "A", price: 10, qty: 0 }).lines).toHaveLength(0);
  });
});

describe("formatMoney", () => {
  const usd = (cents: number) => formatMoney(cents, "USD");

  it("formats whole dollars", () => {
    expect(usd(1000)).toBe("$10.00");
  });

  it("keeps cents", () => {
    expect(usd(1999)).toBe("$19.99");
  });

  it("puts the sign before the symbol", () => {
    expect(usd(-500)).toBe("-$5.00");
  });
});

describe("addItem", () => {
  it("merges a repeated sku into one line", () => {
    const cart = addItem(addItem(emptyCart(), { sku: "A", price: 10, qty: 1 }), { sku: "A", price: 10, qty: 2 });
    expect(cart.lines).toEqual([{ sku: "A", price: 10, qty: 3 }]);
  });

  it("can be undone by removeItem", () => {
    const cart = addItem(emptyCart(), { sku: "A", price: 10, qty: 1 });
    expect(removeItem(cart, "A").lines).toHaveLength(0);
  });
});
