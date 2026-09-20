// Corpus file: the same question in the other frameworks' shapes.
//
// node:test passes options before the body and nests subtests on the
// context; Playwright hangs suites off `test`; Deno takes an object or a
// named function; bun conditions a test with `test.if`. The title is the
// claim in every one of them.

import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyDiscount, removeItem, subtotal, type Cart } from "./cart.ts";

declare const Deno: { test: (...args: unknown[]) => void };
declare const page: { goto(url: string): Promise<void>; title(): Promise<string>; textContent(sel: string): Promise<string | null> };

const cart: Cart = { id: "c1", items: [{ id: 1, price: 10, qty: 2 }, { id: 2, price: 5, qty: 1 }] };

test("subtotal sums price times quantity over the items", { timeout: 1000 }, () => {
  assert.equal(subtotal(cart), 25);
});

test("removeItem drops the item with the given id", { timeout: 1000 }, () => {
  const next = removeItem(cart, 1);
  assert.ok(next.items.length > 0);
});

test("applyDiscount", async (t) => {
  await t.test("takes the percentage off the subtotal", () => {
    assert.equal(applyDiscount(cart, 10), 22.5);
  });

  await t.test("rejects a percentage over one hundred", () => {
    assert.equal(typeof applyDiscount(cart, 150), "number");
  });
});

describe("checkout page", () => {
  test.describe("with an empty cart", () => {
    test("shows the empty-cart message", async () => {
      await page.goto("/checkout");
      assert.equal(await page.textContent("[data-empty]"), "Your cart is empty");
    });

    test("disables the pay button", async () => {
      await page.goto("/checkout");
      assert.ok((await page.title()).length > 0);
    });
  });
});

Deno.test("subtotal of an empty cart is zero", () => {
  assert.equal(subtotal({ id: "e", items: [] }), 0);
});

Deno.test({
  name: "removeItem leaves a cart without the id unchanged",
  fn() {
    const next = removeItem(cart, 99);
    assert.deepEqual(next.items, cart.items);
  },
});

Deno.test(function removeItemKeepsTheOtherItems() {
  const next = removeItem(cart, 1);
  assert.ok(next);
});

test.if(true)("applyDiscount at zero percent returns the subtotal", () => {
  assert.equal(applyDiscount(cart, 0), subtotal(cart));
});

it.each([[0, 25], [50, 12.5]])("applyDiscount at %d percent gives %d", (percent, expected) => {
  assert.equal(applyDiscount(cart, percent), expected);
});
