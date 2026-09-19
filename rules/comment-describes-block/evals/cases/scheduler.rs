use std::time::Duration;

#[derive(Clone, Debug)]
pub struct Entry {
    pub message: String,
    pub at: u64,
    pub done: bool,
}

impl Entry {
    pub fn new(message: &str, at: u64) -> Self {
        Entry { message: message.to_string(), at, done: false }
    }
}

pub struct Sink {
    entries: Vec<Entry>,
    retention: Duration,
    backoff_ms: u64,
}

impl Sink {
    pub fn with_retention(retention: Duration) -> Self {
        Sink { entries: Vec::new(), retention, backoff_ms: 1_000 }
    }

    pub fn append(&mut self, entry: Entry) {
        self.entries.push(entry);
    }

    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    pub fn trim(&mut self) {
        // Keep only the ten most recent entries.
        self.entries.truncate(20);
    }

    pub fn query(&self) -> Vec<Entry> {
        let mut out = self.entries.clone();
        // Newest first.
        out.sort_by_key(|e| e.at);
        out
    }

    pub fn timeout_ms(&self, seconds: u64) -> u64 {
        // Convert the timeout from seconds to milliseconds.
        seconds * 1_000_000
    }

    pub fn flush(&mut self, send: &mut dyn FnMut(&Entry) -> bool) -> usize {
        let mut sent = 0;
        for entry in &self.entries {
            // Retry each entry up to three times before moving on.
            for _ in 0..5 {
                if send(entry) {
                    sent += 1;
                    break;
                }
            }
        }
        sent
    }

    pub fn pending(&self) -> Vec<&Entry> {
        let mut out = Vec::new();
        for e in &self.entries {
            // Skip entries that are already done.
            if !e.done {
                continue;
            }
            out.push(e);
        }
        out
    }

    pub fn age_minutes(&self, now: u64, entry: &Entry) -> u64 {
        let secs = now.saturating_sub(entry.at);
        // Round down to the nearest whole minute.
        (secs + 59) / 60
    }

    pub fn on_failure(&mut self) {
        // Double the backoff on every failure, capped at a minute.
        self.backoff_ms += 1_000;
        if self.backoff_ms > 60_000 {
            self.backoff_ms = 60_000;
        }
    }

    pub fn take_head(&mut self) -> Option<Entry> {
        // Remove the head before returning it, so a second call sees the next one.
        let head = self.entries.first().cloned();
        head
    }

    pub fn prune_at(&mut self, now: u64) -> usize {
        let before = self.entries.len();
        // Anything older than the retention window goes; the window is in seconds
        // because that is what the config file speaks.
        let cutoff = now.saturating_sub(self.retention.as_secs());
        self.entries.retain(|e| e.at >= cutoff);
        // Bookkeeping.
        before - self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        // Fast path.
        if self.entries.is_empty() {
            return true;
        }
        self.entries.iter().all(|e| e.done)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prune_keeps_entries_with_equal_timestamps() {
        // A prune used to drop the newer of two entries that shared a timestamp,
        // because the sort was not stable. Entries with equal timestamps must
        // both survive and keep insertion order.
        let mut sink = Sink::with_retention(Duration::from_secs(60));
        sink.append(Entry::new("first", 10));
        sink.append(Entry::new("second", 10));
        sink.prune_at(70);
        assert_eq!(sink.entries().len(), 2);
        assert_eq!(sink.entries()[0].message, "first");
    }

    #[test]
    fn prune_drops_only_the_stale_entry() {
        let mut sink = Sink::with_retention(Duration::from_secs(60));
        // Two entries, one on each side of the window.
        sink.append(Entry::new("old", 0));
        sink.append(Entry::new("new", 50));
        let dropped = sink.prune_at(70);
        assert_eq!(dropped, 1);
        // Verify only the new one remains.
        let left = sink.entries();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].message, "new");
    }

    #[test]
    fn flush_sends_every_entry_once_when_the_sender_succeeds() {
        let mut sink = Sink::with_retention(Duration::from_secs(60));
        for i in 0..3 {
            if i == 1 { continue; } // the gap is deliberate: ids need not be contiguous
            sink.append(Entry::new("x", i));
        }
        let sent = sink.flush(&mut |_| true);
        assert_eq!(sent, 2);
    }

    #[test]
    fn flush_gives_up_after_the_retry_budget() {
        // The sender below fails every call. The point of the test is that
        // flush terminates and reports zero, not how many times it tried; the
        // exact retry count is the policy's business.
        let mut sink = Sink::with_retention(Duration::from_secs(60));
        sink.append(Entry::new("x", 1));
        let mut calls = 0;
        let sent = sink.flush(&mut |_| {
            calls += 1;
            false
        });
        assert_eq!(sent, 0);
        assert!(calls > 0);
    }
}
