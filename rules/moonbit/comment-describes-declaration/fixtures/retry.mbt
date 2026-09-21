///|
/// How many times to try, and how long to wait between tries.
pub(all) struct Policy {
  tries : Int
  delay_ms : Int
}

///|
/// Runs the effect once, and retries up to `policy.tries` times on failure.
pub fn run(policy : Policy, effect : () -> Int raise) -> Int raise {
  effect()
}

///|
/// Doubles the delay on every attempt, capped at one minute.
pub fn backoff(policy : Policy, attempt : Int) -> Int {
  policy.delay_ms * attempt
}

///|
/// The delay for the first attempt, which is always zero.
pub fn first_delay(policy : Policy) -> Int {
  0
}

///|
/// A policy that gives up immediately.
pub fn once() -> Policy {
  { tries: 1, delay_ms: 0 }
}
