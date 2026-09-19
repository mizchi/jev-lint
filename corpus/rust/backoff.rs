// Corpus file.
// CLEAN (module-name-describes-contents): named `backoff` and every public item
// is about backoff.
//
// The Rust half of the hard-clean class described at the top of
// corpus/ts/session.ts. Names here are defensible rather than obvious: a
// predicate that needs an inference, a mutation that announces itself, a parse
// that can fail, a `get` that computes. The corpus had none of these and a
// cutoff fitted without them sat too close to the boundary.

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

    // CLEAN: a predicate that takes one inference to verify -- being at the
    // ceiling means no further growth -- and says exactly that.
    pub fn is_saturated(&self) -> bool {
        self.next_delay() >= self.max
    }

    // CLEAN: it mutates, and `advance` announces it.
    pub fn advance(&mut self) -> Duration {
        let delay = self.next_delay();
        self.attempt = self.attempt.saturating_add(1);
        delay
    }

    // CLEAN: computes rather than stores, but `next_delay` promises an answer,
    // not a field.
    pub fn next_delay(&self) -> Duration {
        let grown = self.base * 2u32.saturating_pow(self.attempt);
        if grown > self.max { self.max } else { grown }
    }

    // CLEAN: promises a value and can fail, with the failure in the type.
    pub fn parse_base(text: &str) -> Option<Duration> {
        text.trim_end_matches("ms").parse::<u64>().ok().map(Duration::from_millis)
    }

    // CLEAN: resets, and says so.
    pub fn reset(&mut self) {
        self.attempt = 0;
    }

    // DEFECT (fn-name-promises): `summarize` promises a summary; it returns an
    // arbitrary sum of three unrelated numbers. Same accidental defect as
    // `summarize` in corpus/ts/session.ts and `configure` in corpus/ts/cart.ts,
    // and flagged the same way. See docs/findings.md.
    pub fn summarize(&self) -> u64 {
        // CLEAN: a computed value whose name states its unit correctly.
        let retry_delay_millis = self.next_delay().as_millis() as u64;

        // CLEAN: a boolean name bound to a boolean.
        let has_grown = self.attempt > 0;

        // CLEAN: a singular name bound to a single value. The defect in cache.rs
        // is this shape with a PLURAL name, so this case is what stops the rule
        // flagging every `.next()`.
        let first_delay = self.base;

        retry_delay_millis + has_grown as u64 + first_delay.as_millis() as u64
    }
}
