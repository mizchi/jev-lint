///|
pub(all) suberror LoadError String

///|
/// Reads the file, raising when it is not there.
pub fn read_file(path : String) -> String raise {
  if path.is_empty() {
    raise LoadError("no path")
  }
  path
}

///|
pub fn load_config(path : String) -> String {
  try read_file(path) catch {
    _ => ""
  }
}

///|
pub fn load_config_or_default(path : String, fallback : String) -> String {
  try read_file(path) catch {
    _ => fallback
  }
}

///|
pub fn try_read(path : String) -> String {
  try read_file(path) catch {
    _ => ""
  }
}

///|
pub fn read_and_log(path : String) -> String raise {
  try read_file(path) catch {
    e => {
      println("read failed: \{e}")
      raise e
    }
  }
}

///|
pub fn count_lines(path : String) -> Int {
  let text = try read_file(path) catch {
    _ => ""
  }
  text.length()
}

///|
pub fn read_all(paths : Array[String]) -> Array[String] {
  let out = []
  for p in paths {
    let text = try read_file(p) catch {
      _ => ""
    }
    out.push(text)
  }
  out
}

///|
/// The config, or None when it cannot be read.
pub fn config_option(path : String) -> String? {
  try Some(read_file(path)) catch {
    _ => None
  }
}

///|
pub fn read_as_load_error(path : String) -> String raise LoadError {
  try read_file(path) catch {
    _ => raise LoadError("could not read \{path}")
  }
}

///|
pub fn is_readable(path : String) -> Bool {
  try {
    ignore(read_file(path))
    true
  } catch {
    _ => false
  }
}

///|
pub fn total_size(paths : Array[String]) -> Int {
  let mut sum = 0
  for p in paths {
    sum = sum + (try read_file(p) catch { _ => "" }).length()
  }
  sum
}
