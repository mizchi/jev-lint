// Corpus file.

use std::collections::BinaryHeap;
use std::cmp::Reverse;
use std::time::{Duration, Instant};

pub struct Queue<T> {
    items: BinaryHeap<Reverse<(u32, u64)>>,
    payloads: Vec<Option<T>>,
    started_at: Instant,
}

impl<T> Queue<T> {
    pub fn new() -> Self {
        Queue { items: BinaryHeap::new(), payloads: Vec::new(), started_at: Instant::now() }
    }

    pub fn push(&mut self, priority: u32, item: T) {
        let idx = self.payloads.len() as u64;
        self.payloads.push(Some(item));
        self.items.push(Reverse((priority, idx)));
    }

    pub fn pop(&mut self) -> Option<T> {
        let Reverse((_, idx)) = self.items.pop()?;
        self.payloads[idx as usize].take()
    }

    pub fn depth(&self) -> usize {
        self.items.len()
    }

    pub fn uptime(&self) -> Duration {
        self.started_at.elapsed()
    }
}
