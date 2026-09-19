// Corpus file: test titles against what the bodies actually assert.
//
// This is the sharpest case for a natural-language rule, because both halves of
// the comparison are handed to the question by name -- the matcher captures the
// title string and the body separately. Nothing mechanical can compare them.

import { findItemById, sumPrices, type Item } from "./cart.ts";

declare function describe(name: string, body: () => void): void;
declare function it(name: string, body: () => void): void;
declare function expect(value: unknown): {
  toBe(v: unknown): void;
  toBeNull(): void;
  toThrow(): void;
  toEqual(v: unknown): void;
};

const items: Item[] = [
  { id: 1, price: 100, qty: 2 },
  { id: 2, price: 50, qty: 1 },
];

describe("cart", () => {
  // DEFECT (test-name-matches-body): the title names the empty case; the body
  // exercises the non-empty one and asserts it succeeds.
  it("returns zero for an empty item list", () => {
    expect(sumPrices(items)).toBe(250);
  });

  // DEFECT (test-name-matches-body): the title says it throws; the body
  // asserts a returned value and never checks for a throw.
  it("throws when the item list is empty", () => {
    expect(sumPrices([])).toBe(0);
  });

  // DEFECT (test-name-matches-body): the title claims an ordering guarantee;
  // the body only counts the results, so the named behaviour could be broken
  // and this test would still pass.
  it("returns items sorted by price", () => {
    expect(items.length).toBe(2);
  });

  // DEFECT (test-name-matches-body): asserts nothing at all.
  it("rejects a negative quantity", () => {
    sumPrices([{ id: 3, price: 10, qty: -1 }]);
  });

  // CLEAN: the body asserts exactly the named behaviour.
  it("returns null for an unknown id", () => {
    expect(findItemById(items, 999)).toBeNull();
  });

  // CLEAN: title and assertion agree, including the arithmetic.
  it("sums price times quantity across items", () => {
    expect(sumPrices(items)).toBe(250);
  });

  // CLEAN: finds the item the title names.
  it("finds an item by its id", () => {
    expect(findItemById(items, 2)).toEqual({ id: 2, price: 50, qty: 1 });
  });
});
