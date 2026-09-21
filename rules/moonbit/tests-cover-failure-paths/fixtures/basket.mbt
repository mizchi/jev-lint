///|
pub(all) suberror BasketError String

///|
/// The total of the lines.
pub fn basket_total(prices : Array[Int]) -> Int {
  let mut sum = 0
  for p in prices {
    sum = sum + p
  }
  sum
}

///|
/// Applies a coupon, refusing one that is out of range or expired.
pub fn apply_coupon(total : Int, percent : Int, expires_at : Int, now : Int) -> Int raise {
  if percent < 0 || percent > 100 {
    raise BasketError("percent out of range")
  }
  if expires_at < now {
    raise BasketError("coupon expired")
  }
  total * (100 - percent) / 100
}

///|
/// The cheapest price, or None for an empty basket.
pub fn cheapest(prices : Array[Int]) -> Int? {
  if prices.length() == 0 {
    return None
  }
  let mut low = prices[0]
  for p in prices {
    if p < low {
      low = p
    }
  }
  Some(low)
}

///|
/// The price at that position; aborts when the position is not in the basket.
pub fn price_at(prices : Array[Int], index : Int) -> Int {
  if index < 0 || index >= prices.length() {
    abort("no line at \{index}")
  }
  prices[index]
}
