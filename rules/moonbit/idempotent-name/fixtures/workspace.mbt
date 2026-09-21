///|
/// The workspace a build keeps on disk, modelled in memory.
pub(all) struct Entry {
  path : String
  mut body : String
}

///|
pub(all) struct Profile {
  name : String
  root : String
}

///|
pub(all) struct Schema {
  mut ready : Bool
  tables : Array[String]
}

///|
pub(all) suberror AlreadyLocked {
  AlreadyLocked(String)
}

///|
let files : Map[String, Entry] = Map::new()

///|
let dirs : Array[String] = []

///|
let profiles : Array[Profile] = []

///|
let counters : Map[String, Int] = Map::new()

///|
let schema : Schema = { ready: false, tables: [] }

///|
fn record_dir(path : String) -> Unit {
  dirs.push(path)
}

///|
fn store_entry(path : String, body : String) -> Unit {
  files.set(path, { path, body })
}

///|
pub fn ensure_file(path : String, body : String) -> Unit {
  files.set(path, { path, body })
}

///|
pub fn ensure_dir(path : String) -> Unit {
  if dirs.contains(path) {
    return
  }
  dirs.push(path)
}

///|
pub fn ensure_cache_dir(root : String) -> Unit {
  ensure_dir(root + "/.cache")
  ensure_dir(root + "/.cache/objects")
}

///|
pub fn ensure_counter(name : String) -> Unit {
  if counters.contains(name) {
    return
  }
  counters.set(name, 0)
}

///|
pub fn upsert_setting(path : String, body : String) -> Unit {
  match files.get(path) {
    Some(entry) => entry.body = body
    None => files.set(path, { path, body })
  }
}

///|
pub fn upsert_profile(name : String, root : String) -> Unit {
  let profile = { name, root }
  profiles.push(profile)
  ensure_dir(root)
}

///|
pub fn setup_lockfile(root : String) -> Unit raise AlreadyLocked {
  let path = root + "/.lock"
  if files.contains(path) {
    raise AlreadyLocked(path)
  }
  files.set(path, { path, body: "locked" })
}

///|
pub fn setup_workspace(root : String) -> Unit {
  ensure_dir(root)
  ensure_dir(root + "/.cache")
  dirs.push(root + "/tmp")
}

///|
pub fn setup_audit(root : String) -> Unit {
  record_dir(root + "/audit")
}

///|
pub fn install_bundle(name : String, body : String) -> Unit {
  store_entry("/bundles/" + name, body)
}

///|
pub fn ensure_schema() -> Unit {
  if schema.ready {
    return
  }
  schema.tables.push("plugins")
  schema.tables.push("settings")
  schema.ready = true
}

///|
pub fn install_runtime(name : String) -> Entry {
  let path = "/runtimes/" + name
  match files.get(path) {
    Some(entry) => entry
    None => {
      let entry = { path, body: name }
      files.set(path, entry)
      entry
    }
  }
}
