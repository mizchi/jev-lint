import { test } from "node:test";
import assert from "node:assert/strict";
import { total } from "../src/cart.ts";

test("total sums the items", () => {
  assert.equal(total([1, 2, 3]), 6);
});
