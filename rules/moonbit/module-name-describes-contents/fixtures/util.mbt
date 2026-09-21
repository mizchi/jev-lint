///|
pub fn clamp(value : Int, low : Int, high : Int) -> Int {
  if value < low {
    low
  } else if value > high {
    high
  } else {
    value
  }
}

///|
pub fn repeat(text : String, times : Int) -> String {
  let mut out = ""
  for _ in 0..<times {
    out = out + text
  }
  out
}
