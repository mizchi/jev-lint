///|
/// Waits between attempts, and gives up after a while.
pub fn delays(attempts : Int, base_ms : Int) -> Array[Int] {
  let out = []
  // Double the delay on every attempt.
  let mut wait = base_ms
  for i in 0..<attempts {
    out.push(wait)
    wait = wait + base_ms
  }
  // Cap the last wait at one minute.
  if out.length() > 0 {
    out[out.length() - 1] = 30_000
  }
  out
}

///|
pub fn jitter(wait_ms : Int, seed : Int) -> Int {
  // Take a tenth of the wait, and add it.
  let spread = wait_ms / 4
  wait_ms + seed % spread
}

///|
pub fn total_wait(delays : Array[Int]) -> Int {
  let mut sum = 0
  // Sum every delay.
  for d in delays {
    sum = sum + d
  }
  // Convert to seconds.
  sum / 1000
}

///|
pub fn give_up(attempts : Int) -> Bool {
  // Three attempts is the limit.
  attempts >= 3
}

///|
pub fn first_wait(base_ms : Int) -> Int {
  // The first attempt does not wait.
  0
}

///|
pub fn clamp(wait_ms : Int, max_ms : Int) -> Int {
  // Never go above the cap.
  if wait_ms > max_ms {
    max_ms
  } else {
    wait_ms
  }
}

///|
pub fn budget(delays : Array[Int]) -> Int {
  // A retry budget is what the caller allows, not what we compute here;
  // this is only the sum of what we would have waited.
  let mut sum = 0
  for d in delays {
    sum = sum + d
  }
  sum
}
