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
    // CLEAN: does what it says.
    pub fn new() -> Self {
        Store { entries: HashMap::new(), hits: 0 }
    }

    // DEFECT (fn-name-promises): `is_empty` reads as a predicate but returns a
    // count.
    pub fn is_empty(&self) -> usize {
        self.entries.len()
    }

    // DEFECT (fn-name-promises): `get` promises a read; this mutates `hits`
    // and removes the entry.
    pub fn get(&mut self, key: &str) -> Option<String> {
        self.hits += 1;
        self.entries.remove(key)
    }

    // DEFECT (fn-name-promises): named for all keys, returns one.
    pub fn all_keys(&self) -> Option<&String> {
        self.entries.keys().next()
    }

    // CLEAN: inserts and says so.
    pub fn insert(&mut self, key: String, value: String) {
        self.entries.insert(key, value);
    }

    // CLEAN: the name promises a count and a count is what comes back.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    // CLEAN: a lookup that may find nothing, which is what the signature says.
    pub fn peek(&self, key: &str) -> Option<&String> {
        self.entries.get(key)
    }

    // DEFECT (fn-name-promises): nothing here configures anything -- it
    // returns the sum of five unrelated numbers. Labelled after the first run
    // flagged it at 0.87 against a clean label; see the note in
    // corpus/ts/cart.ts and docs/findings.md.
    pub fn configure(&self) -> u64 {
        // DEFECT (var-name-describes-value): named seconds, holds milliseconds.
        let timeout_seconds = 30_000u64;

        // DEFECT (var-name-describes-value): reads as a boolean, holds a count.
        let is_full = self.entries.len();

        // DEFECT (var-name-describes-value): plural name, single value.
        let keys = self.entries.keys().next();

        // CLEAN: name and unit agree.
        let timeout_millis = 30_000u64;

        // CLEAN: name describes what the expression produces.
        let entry_count = self.entries.len();

        timeout_seconds + is_full as u64 + keys.map_or(0, |k| k.len()) as u64
            + timeout_millis
            + entry_count as u64
    }
}
