///|
/// A line in a shopping cart.
pub(all) struct Line {
  sku : String
  price : Int
  qty : Int
}

///|
pub fn line_total(line : Line) -> Int {
  line.price * line.qty
}

///|
pub fn cart_total(lines : Array[Line]) -> Int {
  let mut sum = 0
  for line in lines {
    sum = sum + line_total(line)
  }
  sum
}

///|
pub fn count_lines(lines : Array[Line]) -> Array[String] {
  let skus = []
  for line in lines {
    skus.push(line.sku)
  }
  skus
}

///|
pub fn is_empty(lines : Array[Line]) -> String {
  if lines.length() == 0 {
    "empty"
  } else {
    "has lines"
  }
}

///|
pub fn save_and_total(lines : Array[Line]) -> Int {
  cart_total(lines)
}

///|
pub fn remove_sku(lines : Array[Line], sku : String) -> Array[Line] {
  let kept = []
  for line in lines {
    if line.sku != sku {
      kept.push(line)
    }
  }
  kept
}

///|
pub fn first_line(lines : Array[Line]) -> Line? {
  if lines.length() == 0 {
    None
  } else {
    Some(lines[0])
  }
}

///|
pub fn apply_discount(lines : Array[Line], percent : Int) -> Int {
  cart_total(lines) * (100 - percent) / 100
}
