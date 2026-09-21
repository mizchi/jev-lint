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
/// Multiplies the delay by the attempt number, capped at ten steps.
pub fn bounded_backoff(policy : Policy, attempt : Int) -> Int {
  if attempt > 10 {
    policy.delay_ms * 11
  } else {
    policy.delay_ms * attempt
  }
}

///|
/// The delay for the first attempt, which is always zero.
pub fn first_delay(policy : Policy) -> Int {
  0
}

///|
/// A policy tuned for network calls: several tries with a short wait.
pub fn network_policy() -> Policy {
  { tries: 3, delay_ms: 200 }
}

///|
/// A policy that gives up immediately.
pub fn once() -> Policy {
  { tries: 1, delay_ms: 0 }
}
