///|
pub(all) struct Line {
  sku : String
  price : Int
}

///|
pub fn total(lines : Array[Line]) -> Int {
  let mut sum = 0
  for line in lines {
    sum = sum + line.price
  }
  sum
}

///|
pub fn add(lines : Array[Line], line : Line) -> Array[Line] {
  let out = lines.copy()
  out.push(line)
  out
}
