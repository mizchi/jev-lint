// Corpus file. Naming defects only: this compiles, clippy is quiet, and what
// is wrong is visible only to a reader who understands both name and body.
//
// Labels live in corpus/labels.json with the reason for each.

use std::collections::HashMap;

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

    pub fn configure(&self) -> u64 {
        let timeout_seconds = 30_000u64;

        let is_full = self.entries.len();

        let keys = self.entries.keys().next();

        let timeout_millis = 30_000u64;

        let entry_count = self.entries.len();

        timeout_seconds + is_full as u64 + keys.map_or(0, |k| k.len()) as u64
            + timeout_millis
            + entry_count as u64
    }
}
