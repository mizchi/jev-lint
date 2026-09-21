///|
pub fn pad_left(text : String, width : Int, fill : String) -> String {
  let mut out = text
  while out.length() < width {
    out = fill + out
  }
  out
}

///|
pub fn truncate(text : String, width : Int) -> String {
  if text.length() <= width {
    text
  } else {
    text.substring(start=0, end=width)
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
