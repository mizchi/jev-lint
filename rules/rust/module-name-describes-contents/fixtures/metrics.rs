// Corpus file.

use std::time::Duration;

pub struct Counter {
    name: &'static str,
    value: u64,
}

impl Counter {
    pub fn new(name: &'static str) -> Self {
        Counter { name, value: 0 }
    }

    pub fn incr(&mut self, by: u64) {
        self.value += by;
    }

    pub fn name(&self) -> &'static str {
        self.name
    }

    pub fn value(&self) -> u64 {
        self.value
    }
}

pub struct Gauge {
    value: f64,
}

impl Gauge {
    pub fn set(&mut self, value: f64) {
        self.value = value;
    }

    pub fn value(&self) -> f64 {
        self.value
    }
}

pub fn retry_delay(attempt: u32, base: Duration) -> Duration {
    base * 2u32.saturating_pow(attempt)
}
