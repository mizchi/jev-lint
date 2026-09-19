// Corpus file.

use std::time::Duration;

pub struct Backoff {
    attempt: u32,
    base: Duration,
    max: Duration,
}

impl Backoff {
    pub fn new(base: Duration, max: Duration) -> Self {
        Backoff { attempt: 0, base, max }
    }

    pub fn is_saturated(&self) -> bool {
        self.next_delay() >= self.max
    }

    pub fn advance(&mut self) -> Duration {
        let delay = self.next_delay();
        self.attempt = self.attempt.saturating_add(1);
        delay
    }

    pub fn next_delay(&self) -> Duration {
        let grown = self.base * 2u32.saturating_pow(self.attempt);
        if grown > self.max { self.max } else { grown }
    }

    pub fn parse_base(text: &str) -> Option<Duration> {
        text.trim_end_matches("ms").parse::<u64>().ok().map(Duration::from_millis)
    }

    pub fn reset(&mut self) {
        self.attempt = 0;
    }

    pub fn summarize(&self) -> u64 {
        let retry_delay_millis = self.next_delay().as_millis() as u64;

        let has_grown = self.attempt > 0;

        let first_delay = self.base;

        retry_delay_millis + has_grown as u64 + first_delay.as_millis() as u64
    }
}
