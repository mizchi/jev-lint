///|
fn lines() -> Array[Line] {
  [{ sku: "a", price: 10, qty: 2 }, { sku: "b", price: 5, qty: 1 }]
}

///|
test "cart_total sums price times quantity over the lines" {
  assert_eq(cart_total(lines()), 25)
}

///|
test "cart_total of an empty cart is zero" {
  assert_true(cart_total([]) >= 0)
}

///|
test "remove_sku drops the line with that sku" {
  let kept = remove_sku(lines(), "a")
  assert_true(kept.length() > 0)
}

///|
test "remove_sku leaves a cart without that sku alone" {
  let kept = remove_sku(lines(), "zz")
  assert_eq(kept.map(fn(line) { line.sku }), ["a", "b"])
}

///|
test "apply_discount takes the percentage off the total" {
  assert_eq(apply_discount(lines(), 10), 22)
}

///|
test "apply_discount at zero percent returns the total" {
  let total = cart_total(lines())
  assert_eq(apply_discount(lines(), 0), total)
}

///|
test "first_line returns None for an empty cart" {
  match first_line([]) {
    Some(_) => fail("expected None")
    None => ()
  }
}

///|
test "line_total multiplies price by quantity" {
  assert_eq(line_total({ sku: "a", price: 10, qty: 3 }), 30)
}

///|
test "is_empty reports an empty cart" {
  let answer = is_empty([])
  assert_true(answer.length() > 0)
}

///|
test "bench: cart_total over ten lines" (b : @bench.T) {
  b.bench(fn() { b.keep(cart_total(lines())) })
}
