///|
/// The configuration the loader hands to the rest of the program.
pub(all) struct Config {
  host : String
  port : Int
  retries : Int
}

///|
/// The key/value pairs a config file was read into, in file order.
pub(all) struct Raw {
  entries : Array[(String, String)]
}

///|
pub suberror ConfigError {
  BadValue(String)
}

///|
fn lookup(raw : Raw, key : String) -> String? {
  for entry in raw.entries {
    if entry.0 == key {
      return Some(entry.1)
    }
  }
  None
}

///|
pub fn parse_int(text : String) -> Int raise ConfigError {
  if text.length() == 0 {
    raise BadValue("empty")
  }
  let mut acc = 0
  for c in text {
    if c < '0' || c > '9' {
      raise BadValue(text)
    }
    acc = acc * 10 + (c.to_int() - '0'.to_int())
  }
  acc
}

///|
pub fn try_port(raw : Raw) -> Int? {
  match lookup(raw, "port") {
    None => None
    Some(text) =>
      try {
        Some(parse_int(text))
      } catch {
        BadValue(_) => None
      }
  }
}

///|
pub fn port_or_default(raw : Raw, fallback : Int) -> Int {
  match lookup(raw, "port") {
    None => fallback
    Some(text) =>
      try {
        parse_int(text)
      } catch {
        BadValue(v) => abort("config: port is not a number: " + v)
      }
  }
}

///|
pub fn port_or_else(raw : Raw, fallback : () -> Int) -> Int {
  match lookup(raw, "port") {
    None => fallback()
    Some(text) =>
      try {
        parse_int(text)
      } catch {
        BadValue(_) => fallback()
      }
  }
}

///|
pub fn safe_host(raw : Raw) -> String {
  let host = lookup(raw, "host").unwrap()
  if host.length() == 0 {
    "localhost"
  } else {
    host
  }
}

///|
pub fn host_or_default(raw : Raw, fallback : String) -> String {
  match lookup(raw, "host") {
    Some(host) => if host.length() == 0 { fallback } else { host }
    None => fallback
  }
}

///|
pub fn safe_retries(raw : Raw) -> Int {
  let found = lookup(raw, "retries")
  if found is None {
    return 3
  }
  let text = found.unwrap()
  try {
    parse_int(text)
  } catch {
    BadValue(_) => 3
  }
}

///|
pub fn try_config(raw : Raw) -> Config? {
  let host = host_or_default(raw, "localhost")
  match try_port(raw) {
    None => None
    Some(port) => Some({ host, port, retries: safe_retries(raw) })
  }
}
