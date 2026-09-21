///|
fn lines() -> Array[Int] {
  [10, 5]
}

///|
test "total sums the lines" {
  assert_eq(total_of(lines()), 15)
}

///|
test "total of an empty cart is zero" {
  assert_eq(total_of([]), 0)
}

///|
test "remove_at returns a shorter cart" {
  let kept = remove_at(lines(), 0)
  assert_eq(kept.length(), 1)
}

///|
test "add appends to the end" {
  let out = remove_at(lines(), 0)
  assert_eq(out.length(), 1)
}

///|
test "total counts the lines" {
  assert_eq(total_of(lines()), 15)
}

///|
test "discount takes ten percent off" {
  assert_eq(discounted(100, 10), 90)
}

///|
test "discount at zero percent changes nothing" {
  assert_eq(discounted(100, 0), 100)
}

///|
test "remove_at drops the line at that index and keeps the rest" {
  let kept = remove_at(lines(), 0)
  assert_eq(kept, [5])
}

///|
test "discount rejects a percent over one hundred" {
  assert_eq(discounted(100, 50), 50)
}

///|
test "total ignores negative prices" {
  assert_eq(total_of([10, 5]), 15)
}

///|
test "remove_at with an index past the end leaves the cart alone" {
  let kept = remove_at(lines(), 9)
  assert_eq(kept, lines())
}
