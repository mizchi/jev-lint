//! Thin wrappers over the `libframe` C library.

use std::ffi::{c_char, c_int, c_uint, c_void, CStr, CString};
use std::mem;
use std::ptr;

#[repr(C)]
pub struct FrameCtx {
    _private: [u8; 0],
}

extern "C" {
    /// Returns a pointer to a static, NUL-terminated version string that is
    /// valid for the lifetime of the program.
    fn frame_version() -> *const c_char;

    /// Opens the file at `path`. Returns NULL if the file cannot be opened
    /// or is not a frame file.
    fn frame_open(path: *const c_char) -> *mut FrameCtx;

    /// Sets an option on an open context. `ctx` must be non-null.
    fn frame_set_flag(ctx: *mut FrameCtx, flag: c_int) -> c_int;

    /// Closes a context opened by `frame_open`; a NULL `ctx` is ignored.
    /// The context must not be used afterwards.
    fn frame_close(ctx: *mut FrameCtx);

    /// Computes the CRC of `len` bytes starting at `buf`. `buf` is read and
    /// not retained.
    fn frame_crc(seed: c_uint, buf: *const u8, len: c_uint) -> c_uint;

    /// Fills `out` with up to `cap` bytes of the next frame and returns the
    /// number written, or a negative value on error.
    fn frame_read(ctx: *mut FrameCtx, out: *mut u8, cap: c_uint) -> c_int;
}

pub fn version() -> &'static str {
    // SAFETY: frame_version returns a pointer to a static NUL-terminated
    // string that lives for the whole program, so it is valid for 'static
    // and CStr::from_ptr may read it.
    let raw = unsafe { CStr::from_ptr(frame_version()) };
    raw.to_str().unwrap_or("unknown")
}

pub fn crc(seed: u32, buf: &[u8]) -> u32 {
    let len = c_uint::try_from(buf.len()).expect("buffer longer than u32");
    // SAFETY: buf.as_ptr() is valid for buf.len() bytes for the duration of
    // the call, which is all frame_crc reads, and it does not keep the
    // pointer.
    unsafe { frame_crc(seed, buf.as_ptr(), len) }
}

pub struct Reader {
    ctx: *mut FrameCtx,
}

impl Reader {
    pub fn open(path: &str) -> Result<Reader, String> {
        let c_path = CString::new(path).map_err(|e| e.to_string())?;
        // SAFETY: c_path is a valid NUL-terminated string for the duration
        // of the call, and frame_open does not retain it.
        let ctx = unsafe { frame_open(c_path.as_ptr()) };
        // SAFETY: frame_open returns a valid context for a well-formed path,
        // so ctx is non-null here.
        let rc = unsafe { frame_set_flag(ctx, 1) };
        if rc != 0 {
            return Err(format!("frame_set_flag failed: {rc}"));
        }
        Ok(Reader { ctx })
    }

    pub fn read_into(&mut self, out: &mut [u8]) -> Result<usize, i32> {
        let cap = c_uint::try_from(out.len()).unwrap_or(c_uint::MAX);
        // SAFETY: self.ctx is non-null because open returns Err before
        // constructing a Reader with a null context; out is a slice, so it
        // is valid for writes of out.len() bytes, which is the cap passed.
        let n = unsafe { frame_read(self.ctx, out.as_mut_ptr(), cap) };
        if n < 0 {
            Err(n)
        } else {
            Ok(n as usize)
        }
    }
}

impl Drop for Reader {
    fn drop(&mut self) {
        // SAFETY: ctx came from frame_open and is closed exactly once, here;
        // the Reader is not usable after drop.
        unsafe { frame_close(self.ctx) }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tag {
    Header = 0,
    Data = 1,
    Trailer = 2,
}

impl Tag {
    const LAST: u8 = Tag::Trailer as u8;

    pub fn from_wire(byte: u8) -> Option<Tag> {
        if byte > Tag::LAST {
            return None;
        }
        // SAFETY: Tag is repr(u8) with contiguous discriminants 0..=LAST,
        // and byte <= LAST was checked above, so every value reaching
        // here is a valid Tag.
        Some(unsafe { mem::transmute::<u8, Tag>(byte) })
    }

    pub fn from_raw(byte: u8) -> Tag {
        // SAFETY: this conversion is safe.
        unsafe { mem::transmute::<u8, Tag>(byte) }
    }
}

pub fn zeroed_ctx_slot() -> *mut c_void {
    // SAFETY: a null pointer is a valid value of every raw pointer type,
    // and this is only a placeholder the caller fills in.
    unsafe { mem::transmute::<usize, *mut c_void>(0) }
}

pub fn ptr_or_null(p: Option<&FrameCtx>) -> *const FrameCtx {
    match p {
        Some(r) => r as *const FrameCtx,
        None => ptr::null(),
    }
}
