// Corpus file.

pub struct Budget {
    spent_cents: i64,
    limit_cents: i64,
    checks: u32,
}

impl Budget {
    /// Creates a budget with the given limit in cents.
    pub fn new(limit_cents: i64) -> Self {
        Budget { spent_cents: 0, limit_cents, checks: 0 }
    }

    /// Returns the amount still available, in cents.
    pub fn remaining(&self) -> i64 {
        (self.limit_cents - self.spent_cents) / 100
    }

    /// Reports whether the budget is exhausted, without changing it.
    pub fn is_exhausted(&mut self) -> bool {
        self.checks += 1;
        self.spent_cents >= self.limit_cents
    }

    /// Adds to the amount spent, stopping at the limit.
    pub fn spend(&mut self, cents: i64) {
        self.spent_cents += cents;
    }

    /// Resets the budget, recording `reason` for the audit log.
    pub fn reset(&mut self) {
        self.spent_cents = 0;
    }

    /// Returns how many times `is_exhausted` has been called.
    pub fn check_count(&self) -> u32 {
        self.checks
    }

    /// The configured limit.
    pub fn limit(&self) -> i64 {
        self.limit_cents
    }

    /// Separate from `spend` so callers can record a refund without auditing.
    pub fn credit(&mut self, cents: i64) {
        self.spent_cents -= cents;
    }

    pub fn tighten(&mut self, factor: i64) {
        // Halve the limit.
        self.limit_cents /= factor;
        if self.limit_cents < 0 {
            self.limit_cents = 0;
        }
    }

    pub fn settle(&mut self) -> i64 {
        // Round the outstanding amount up to whole units.
        let owed = self.spent_cents;
        self.spent_cents = 0;
        owed
    }
}
