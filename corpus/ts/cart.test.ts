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
  // DEFECT (test-name-describes-code, test-name-verifies-claim): the title
  // names the empty case; the body
  // exercises the non-empty one. Wrong THING, not a weak assertion.
  it("returns zero for an empty item list", () => {
    expect(sumPrices(items)).toBe(250);
  });

  // DEFECT (test-name-describes-code, test-name-verifies-claim): the title
  // says it throws; the body
  // expects an ordinary value. Wrong THING.
  it("throws when the item list is empty", () => {
    expect(sumPrices([])).toBe(0);
  });

  // DEFECT (test-name-verifies-claim): the title claims an ordering guarantee
  // and the body counts the results, so the named behaviour could be broken and
  // this would still pass. Right thing, assertion too WEAK.
  it("returns items sorted by price", () => {
    expect(items.length).toBe(2);
  });

  // DEFECT (test-name-verifies-claim): asserts nothing at all, so nothing it
  // claims is established.
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

  // The three tests below open with a PREAMBLE: a comment that says what the
  // whole test is for, sitting above whatever the first statement happens to
  // be. comment-describes-block matches the statement under it, and on real
  // code read preambles at 0.81-0.91 -- above the corpus's clean band, which
  // had none. They are the hard clean case for that rule.

  // CLEAN (comment-describes-block): the preamble describes the whole test, not
  // the line under it. Judged against the body, every claim holds.
  it("keeps the input list untouched", () => {
    // Summing must not sort or mutate the caller's array: a later test relies
    // on the original order, and the function is documented as read-only.
    const before = items.map((i) => i.id);
    sumPrices(items);
    expect(items.map((i) => i.id)).toEqual(before);
  });

  // CLEAN (comment-describes-block): a preamble stating the reason for the
  // test, above a setup line that has nothing to do with the reason.
  it("treats a zero quantity as contributing nothing", () => {
    // A zero-quantity line is how the cart represents "removed but kept for the
    // undo stack", so it has to be worth nothing rather than rejected.
    const withZero = [...items, { id: 3, price: 999, qty: 0 }];
    expect(sumPrices(withZero)).toBe(250);
  });

  // CLEAN (comment-describes-block): a preamble that names the bug the test
  // guards against, above an ordinary first statement.
  it("does not double-count an item listed twice", () => {
    // Found in production: a duplicated line item was summed once per
    // occurrence, which is correct, but the fixture here once shared an id and
    // the old dedupe-by-id dropped one. Both occurrences must count.
    const doubled = [...items, items[0]!];
    expect(sumPrices(doubled)).toBe(450);
  });
});
