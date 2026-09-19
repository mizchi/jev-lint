// Corpus file. Naming defects only: this compiles, clippy is quiet, and what
// is wrong is visible only to a reader who understands both name and body.
//
// Labels live in corpus/labels.json with the reason for each.

use std::collections::HashMap;
use std::time::Duration;

pub struct Store {
    entries: HashMap<String, String>,
    hits: u64,
}

impl Store {
    pub fn new() -> Self {
        Store { entries: HashMap::new(), hits: 0 }
    }

    pub fn is_empty(&self) -> usize {
        self.entries.len()
    }

    pub fn get(&mut self, key: &str) -> Option<String> {
        self.hits += 1;
        self.entries.remove(key)
    }

    pub fn all_keys(&self) -> Option<&String> {
        self.entries.keys().next()
    }

    pub fn insert(&mut self, key: String, value: String) {
        self.entries.insert(key, value);
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn peek(&self, key: &str) -> Option<&String> {
        self.entries.get(key)
    }

    pub fn configure(&self) -> Duration {
        let timeout_seconds = 30_000u64;
        let ttl = Duration::from_millis(timeout_seconds);

        let is_full = self.entries.len();

        let keys = self.entries.keys().next();

        let entry_count = self.entries.len();

        let retries = 3;

        if is_full > 0 && keys.is_some() && entry_count < retries {
            return ttl;
        }
        ttl
    }

    pub fn sweep_interval(&self) -> Duration {
        let timeout_millis = 30_000u64;
        let n = self.entries.len();
        if n == 0 {
            return Duration::from_millis(timeout_millis);
        }
        Duration::from_millis(timeout_millis / n as u64)
    }
}
