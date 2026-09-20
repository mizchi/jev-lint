//! A growable byte buffer with manual allocation, used as the staging area
//! for the frame encoder.

use std::alloc::{self, Layout};
use std::ptr;
use std::slice;

pub struct RawBuf {
    ptr: *mut u8,
    len: usize,
    cap: usize,
}

impl RawBuf {
    pub fn with_capacity(cap: usize) -> Self {
        let cap = cap.max(16);
        let layout = Layout::array::<u8>(cap).expect("capacity overflow");
        // SAFETY: cap is at least 16, so the layout has a non-zero size,
        // which is what alloc requires.
        let ptr = unsafe { alloc::alloc(layout) };
        if ptr.is_null() {
            alloc::handle_alloc_error(layout);
        }
        RawBuf { ptr, len: 0, cap }
    }

    fn grow(&mut self) {
        let new_cap = self.cap * 2;
        let old = Layout::array::<u8>(self.cap).expect("capacity overflow");
        let new = Layout::array::<u8>(new_cap).expect("capacity overflow");
        // SAFETY: ptr was allocated by this type with `old`, and the new size
        // is non-zero and does not overflow isize because Layout::array
        // checked it.
        let ptr = unsafe { alloc::realloc(self.ptr, old, new.size()) };
        if ptr.is_null() {
            alloc::handle_alloc_error(new);
        }
        self.ptr = ptr;
        self.cap = new_cap;
    }

    pub fn push(&mut self, byte: u8) {
        if self.len == self.cap {
            self.grow();
        }
        // SAFETY: len < cap after the grow above, so ptr.add(len) is within
        // the allocation and has not been handed out to anyone.
        unsafe {
            ptr::write(self.ptr.add(self.len), byte);
        }
        self.len += 1;
    }

    pub fn extend_from_slice(&mut self, bytes: &[u8]) {
        while self.cap - self.len < bytes.len() {
            self.grow();
        }
        // SAFETY: the loop above leaves at least bytes.len() spare bytes
        // after len; the source is a slice, so it is valid for its length
        // and cannot overlap our allocation.
        unsafe {
            ptr::copy_nonoverlapping(bytes.as_ptr(), self.ptr.add(self.len), bytes.len());
        }
        self.len += bytes.len();
    }

    pub fn as_slice(&self) -> &[u8] {
        // SAFETY: the first len bytes were written by push or
        // extend_from_slice and len never exceeds cap; the slice borrows
        // self, so the allocation outlives it.
        unsafe { slice::from_raw_parts(self.ptr, self.len) }
    }

    /// The bytes from `start` up to the end of the buffer.
    pub fn tail(&self, start: usize) -> Option<&[u8]> {
        if start > self.len {
            return None;
        }
        // SAFETY: start <= len, checked above, so ptr.add(start) is inside
        // the initialised region or one past it, len - start does not
        // underflow, and the slice borrows self.
        let rest = unsafe { slice::from_raw_parts(self.ptr.add(start), self.len - start) };
        Some(rest)
    }

    /// The byte at `index`, or None past the end.
    pub fn window(&self, index: usize, width: usize) -> Option<&[u8]> {
        if index >= self.len {
            return None;
        }
        let end = index + width;
        // SAFETY: end < len, checked above, so every byte in the window is
        // initialised.
        let bytes = unsafe { slice::from_raw_parts(self.ptr.add(index), end - index) };
        Some(bytes)
    }

    /// Everything written so far, followed by the terminator byte that
    /// `finish` writes.
    pub fn framed(&self) -> &[u8] {
        // SAFETY: cap >= len + 1 after the grow in push, so the byte at len
        // is inside the allocation and the frame terminator sits there.
        unsafe { slice::from_raw_parts(self.ptr, self.len + 1) }
    }

    /// A view of the buffer that the caller may keep.
    pub fn leaked_view(&self) -> &'static [u8] {
        // SAFETY: the bytes live as long as self, and the returned slice
        // borrows self.
        unsafe { slice::from_raw_parts(self.ptr.cast_const(), self.len) }
    }

    pub fn clear(&mut self) {
        self.len = 0;
    }
}

impl Drop for RawBuf {
    fn drop(&mut self) {
        let layout = Layout::array::<u8>(self.cap).expect("capacity overflow");
        // SAFETY: ptr was allocated with exactly this layout by
        // with_capacity or grow, and nothing else frees it.
        unsafe { alloc::dealloc(self.ptr, layout) }
    }
}
