///|
test "basket_total sums the prices" {
  assert_eq(basket_total([10, 5]), 15)
}

///|
test "basket_total of an empty basket is zero" {
  assert_eq(basket_total([]), 0)
}

///|
test "apply_coupon takes the percentage off" {
  assert_eq(apply_coupon(100, 10, 2000, 1000), 90)
}

///|
test "cheapest returns None for an empty basket" {
  match cheapest([]) {
    Some(_) => fail("expected None")
    None => ()
  }
}

///|
test "cheapest finds the lowest price" {
  match cheapest([10, 5]) {
    Some(p) => assert_eq(p, 5)
    None => fail("expected a price")
  }
}

///|
test "price_at returns the line at that position" {
  assert_eq(price_at([10, 5], 1), 5)
}
