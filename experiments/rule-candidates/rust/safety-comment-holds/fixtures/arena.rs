//! A slot arena for parser nodes. Slots are never removed; a freed slot is
//! marked `Empty` and reused by the next `alloc`.

use std::hint;

#[derive(Debug)]
pub enum Slot<T> {
    Empty,
    Full(T),
}

/// An index into an [`Arena`], only obtainable from [`Arena::alloc`] or
/// [`Handle::new`], both of which check it against the slot count.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Handle {
    index: usize,
}

impl Handle {
    pub fn new<T>(index: usize, arena: &Arena<T>) -> Option<Handle> {
        if index < arena.slots.len() {
            Some(Handle { index })
        } else {
            None
        }
    }

    pub fn index(self) -> usize {
        self.index
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Id(pub usize);

pub struct Arena<T> {
    slots: Vec<Slot<T>>,
    generations: Vec<u32>,
    free: Vec<usize>,
}

impl<T> Arena<T> {
    pub fn new() -> Self {
        Arena { slots: Vec::new(), generations: Vec::new(), free: Vec::new() }
    }

    pub fn alloc(&mut self, value: T) -> Handle {
        if let Some(index) = self.free.pop() {
            self.slots[index] = Slot::Full(value);
            self.generations[index] += 1;
            return Handle { index };
        }
        self.slots.push(Slot::Full(value));
        self.generations.push(0);
        Handle { index: self.slots.len() - 1 }
    }

    pub fn release(&mut self, handle: Handle) {
        self.slots[handle.index] = Slot::Empty;
        self.free.push(handle.index);
    }

    pub fn lookup(&self, id: Id) -> Option<&T> {
        if id.0 >= self.slots.len() {
            return None;
        }
        // SAFETY: id.0 < slots.len(), checked above.
        match unsafe { self.slots.get_unchecked(id.0) } {
            Slot::Full(value) => Some(value),
            Slot::Empty => None,
        }
    }

    /// The generation counter for `id`, or None if `id` was never allocated.
    pub fn generation(&self, id: Id) -> Option<u32> {
        if id.0 >= self.generations.len() {
            return None;
        }
        // SAFETY: id.0 < generations.len(), checked above, and generations
        // is grown in lockstep with slots.
        Some(unsafe { *self.generations.get_unchecked(id.0) })
    }

    /// Both values, or None if either id is out of range or empty.
    pub fn pair(&self, a: Id, b: Id) -> Option<(&T, &T)> {
        if a.0 >= self.slots.len() || b.0 >= self.free.len() {
            return None;
        }
        // SAFETY: both indices were checked against the vec they index.
        let (sa, sb) = unsafe { (self.slots.get_unchecked(a.0), self.slots.get_unchecked(b.0)) };
        match (sa, sb) {
            (Slot::Full(x), Slot::Full(y)) => Some((x, y)),
            _ => None,
        }
    }

    pub fn resolve(&self, handle: Handle) -> &Slot<T> {
        // SAFETY: Handle's index field is private and is only set by alloc
        // and Handle::new, both of which bound it by slots.len(); slots
        // never shrink, so the index is still in range.
        unsafe { self.slots.get_unchecked(handle.index) }
    }

    pub fn first_empty(&self) -> Option<usize> {
        for i in 0..self.slots.len() {
            // SAFETY: i < len, loop bound.
            if let Slot::Empty = unsafe { self.slots.get_unchecked(i) } {
                return Some(i);
            }
        }
        None
    }

    pub fn count_full(&self) -> usize {
        let mut n = 0;
        let len = self.slots.len();
        let mut i = 0;
        while i <= len {
            // SAFETY: i is bounded by len, so the index is in range.
            if let Slot::Full(_) = unsafe { self.slots.get_unchecked(i) } {
                n += 1;
            }
            i += 1;
        }
        n
    }

    pub fn get_mut(&mut self, handle: Handle) -> &mut T {
        match &mut self.slots[handle.index] {
            Slot::Full(value) => value,
            // SAFETY: the caller holds a Handle, and a Handle is only
            // returned by alloc, which stores a Full slot at its index.
            Slot::Empty => unsafe { hint::unreachable_unchecked() },
        }
    }

    pub fn len(&self) -> usize {
        self.slots.len()
    }
}
