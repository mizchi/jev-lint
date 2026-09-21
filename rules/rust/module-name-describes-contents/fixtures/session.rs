// Corpus file.

use std::time::{Duration, Instant};

pub struct SessionId(pub String);

pub struct Session {
    pub id: SessionId,
    pub user_id: u64,
    expires_at: Instant,
}

pub fn create_session(user_id: u64, ttl: Duration) -> Session {
    Session {
        id: SessionId(format!("sess_{user_id}")),
        user_id,
        expires_at: Instant::now() + ttl,
    }
}

pub fn refresh_session(session: &mut Session, ttl: Duration) {
    session.expires_at = Instant::now() + ttl;
}

pub fn invalidate_session(session: &mut Session) {
    session.expires_at = Instant::now();
}

pub fn hash_password(password: &str) -> String {
    let mut acc: u64 = 0xcbf29ce484222325;
    for b in password.bytes() {
        acc ^= b as u64;
        acc = acc.wrapping_mul(0x100000001b3);
    }
    format!("{acc:x}")
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    hash_password(password) == hash
}
