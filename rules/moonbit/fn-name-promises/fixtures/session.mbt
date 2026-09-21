///|
/// A user's session, as the store keeps it.
pub(all) struct Session {
  id : String
  user : String
  expires_at : Int
}

///|
let store : Map[String, Session] = Map::new()

///|
pub fn get_session(id : String) -> Session? {
  store.get(id)
}

///|
pub fn take_session(id : String) -> Session? {
  let found = store.get(id)
  store.remove(id)
  found
}

///|
pub fn touch_session(id : String, now : Int) -> Unit {
  match store.get(id) {
    Some(session) => store.set(id, { ..session, expires_at: now + 3600 })
    None => ()
  }
}

///|
pub fn validate_session(id : String, now : Int) -> Bool {
  match store.get(id) {
    Some(session) => {
      store.set(id, { ..session, expires_at: now + 3600 })
      session.expires_at > now
    }
    None => false
  }
}

///|
pub fn drop_expired(now : Int) -> Int {
  let mut dropped = 0
  for id, session in store {
    if session.expires_at <= now {
      dropped = dropped + 1
    }
  }
  dropped
}

///|
pub fn session_count() -> Int {
  store.size()
}

///|
pub fn ensure_session(id : String, user : String, now : Int) -> Session {
  match store.get(id) {
    Some(session) => session
    None => {
      let session = { id, user, expires_at: now + 3600 }
      store.set(id, session)
      session
    }
  }
}
