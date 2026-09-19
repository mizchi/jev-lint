// Corpus file.
// CLEAN (module-name-describes-contents): named for the budget it tracks.
//
// The Rust half of the comment-drift corpus. See corpus/ts/session_store.ts for
// what the CLEAN cases are doing there: a vague, redundant or why-not-what
// comment is accurate and must not be flagged, because the axis is whether the
// claim is false, not whether the comment is worth having.

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

    // DEFECT (comment-describes-declaration): says cents, returns whole units.
    /// Returns the amount still available, in cents.
    pub fn remaining(&self) -> i64 {
        (self.limit_cents - self.spent_cents) / 100
    }

    // DEFECT (comment-describes-declaration, fn-name-promises): the comment
    // claims it leaves the budget untouched and it increments `checks` -- which
    // makes it a false comment AND a predicate name on a mutating function.
    // Both rules are right about it; flagged by fn-name-promises at 0.82 while
    // this marker named only the comment rule.
    /// Reports whether the budget is exhausted, without changing it.
    pub fn is_exhausted(&mut self) -> bool {
        self.checks += 1;
        self.spent_cents >= self.limit_cents
    }

    // DEFECT (comment-describes-declaration): says it saturates at the limit,
    // and it does not clamp at all.
    /// Adds to the amount spent, stopping at the limit.
    pub fn spend(&mut self, cents: i64) {
        self.spent_cents += cents;
    }

    // DEFECT (comment-describes-declaration): documents a `reason` parameter
    // the function no longer takes.
    /// Resets the budget, recording `reason` for the audit log.
    pub fn reset(&mut self) {
        self.spent_cents = 0;
    }

    // CLEAN: accurate and specific.
    /// Returns how many times `is_exhausted` has been called.
    pub fn check_count(&self) -> u32 {
        self.checks
    }

    // CLEAN: vague but not false -- the hard clean case.
    /// The configured limit.
    pub fn limit(&self) -> i64 {
        self.limit_cents
    }

    // CLEAN: explains why, so there is no behavioural claim to contradict.
    /// Separate from `spend` so callers can record a refund without auditing.
    pub fn credit(&mut self, cents: i64) {
        self.spent_cents -= cents;
    }

    pub fn tighten(&mut self, factor: i64) {
        // DEFECT (comment-describes-block): says it halves the limit, and it
        // divides by the factor it was given.
        // Halve the limit.
        self.limit_cents /= factor;
        // CLEAN: describes exactly what follows.
        // Never let the limit go below zero.
        if self.limit_cents < 0 {
            self.limit_cents = 0;
        }
    }

    pub fn settle(&mut self) -> i64 {
        // DEFECT (comment-describes-block): says it rounds up, and it truncates.
        // Round the outstanding amount up to whole units.
        let units = self.spent_cents / 100;
        self.spent_cents = 0;
        units
    }
}
