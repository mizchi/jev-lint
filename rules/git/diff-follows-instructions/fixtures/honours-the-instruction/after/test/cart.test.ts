import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCoupon, total } from "../src/cart.ts";

test("total sums the items", () => {
  assert.equal(total([1, 2, 3]), 6);
});

test("applyCoupon takes ten percent off for SAVE10", () => {
  assert.equal(applyCoupon(100, "SAVE10"), 90);
});

test("applyCoupon leaves the total alone for an unknown code", () => {
  assert.equal(applyCoupon(100, "NOPE"), 100);
});
