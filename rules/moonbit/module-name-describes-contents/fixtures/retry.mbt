///|
/// The wait between two attempts.
pub fn delay_ms(attempt : Int, base_ms : Int) -> Int {
  base_ms * attempt
}

///|
pub fn should_retry(status : Int) -> Bool {
  status >= 500
}

///|
pub fn attempts_for(status : Int) -> Int {
  if should_retry(status) {
    3
  } else {
    1
  }
}
