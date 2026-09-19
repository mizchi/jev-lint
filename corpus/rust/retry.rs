// Corpus file.
// CLEAN (module-name-describes-contents): the module is called
// `retry` and every public item is about retrying.

use std::time::Duration;

pub struct RetryPolicy {
    pub attempts: u32,
    pub base_delay: Duration,
}

impl RetryPolicy {
    pub fn new(attempts: u32, base_delay: Duration) -> Self {
        RetryPolicy { attempts, base_delay }
    }

    pub fn delay_for_attempt(&self, attempt: u32) -> Duration {
        self.base_delay * 2u32.saturating_pow(attempt)
    }

    pub fn should_retry(&self, attempt: u32) -> bool {
        attempt < self.attempts
    }
}

pub fn total_delay(policy: &RetryPolicy) -> Duration {
    (0..policy.attempts).map(|a| policy.delay_for_attempt(a)).sum()
}
