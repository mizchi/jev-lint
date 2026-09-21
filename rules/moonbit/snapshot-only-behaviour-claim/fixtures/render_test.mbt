///|
test "renders" {
  inspect(render([10, 5]), content="10,5")
}

///|
test "renders the receipt for a two-line cart" {
  inspect(render([10, 5]), content="10,5")
}

///|
test "hides the discount row when no discount applies" {
  inspect(render_with_discount([10, 5], 0), content="10,5")
}

///|
test "orders the rows by price, cheapest first" {
  inspect(render([10, 5]), content="5,10")
}

///|
test "shows the total in the footer" {
  let out = render([10, 5])
  assert_true(out.contains("15"))
  inspect(out, content="10,5|15")
}

///|
test "matches the snapshot for an empty cart" {
  inspect(render([]), content="")
}

///|
test "escapes the ampersand in a sku" {
  inspect(render_sku("a&b"), content="a&amp;b")
}

///|
test "renders the loading state" {
  inspect(render_state("loading"), content="loading...")
}

///|
test "totals the lines" {
  assert_eq(total([10, 5]), 15)
}

///|
test "omits the tax line for an exempt customer" {
  inspect(render_for("exempt"), content="10,5")
}

///|
test "truncates a description longer than forty characters" {
  inspect(render_sku("a-very-long-sku-name-that-goes-on"), content="a-very-long-sku-name-that-goes-on")
}

///|
test "keeps the columns aligned when a price is wider" {
  inspect(render([1000000, 5]), content="1000000,5")
}
