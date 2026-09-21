///|
pub(all) suberror ParseError String

///|
/// Reads the port from the line.
/// Raises ParseError when the line has no `=`.
pub fn port_of(line : String) -> Int raise {
  match line.split("=").collect() {
    [_, value] => @strconv.parse_int(value) catch { _ => raise ParseError(line) }
    _ => 0
  }
}

///|
/// The second-highest value in the list.
/// Panics when the list has fewer than two entries.
pub fn second_highest(values : Array[Int]) -> Int {
  if values.length() < 2 {
    abort("need at least two values")
  }
  let sorted = values.copy()
  sorted.sort()
  sorted[sorted.length() - 2]
}

///|
/// Returns the value for the key.
/// Returns None when the key is absent.
pub fn value_of(lines : Array[String], key : String) -> String? {
  for line in lines {
    if line.has_prefix(key) {
      return Some(line)
    }
  }
  abort("key not found: \{key}")
}

///|
/// Parses every line.
/// Never fails: a line it cannot read is skipped.
pub fn parse_all(lines : Array[String]) -> Array[Int] raise {
  let out = []
  for line in lines {
    out.push(port_of(line))
  }
  out
}

///|
/// The first line, or None when there are none.
pub fn first(lines : Array[String]) -> String? {
  if lines.length() == 0 {
    None
  } else {
    Some(lines[0])
  }
}

///|
/// The discounted price.
/// Raises ParseError when the discount percent is negative.
pub fn apply_discount(price : Int, percent : Int) -> Int raise {
  if percent <= 0 {
    raise ParseError("bad discount")
  }
  price - price * percent / 100
}

///|
/// Reads the timeout.
/// Raises ParseError when the value is not a number.
pub fn timeout_of(line : String) -> Int raise {
  @strconv.parse_int(line) catch { _ => raise ParseError(line) }
}

///|
/// Counts the lines that carry a key.
pub fn count_keys(lines : Array[String]) -> Int {
  let mut n = 0
  for line in lines {
    if line.contains("=") {
      n = n + 1
    }
  }
  n
}

///|
fn require_entry(table : Map[String, String], key : String) -> String raise {
  match table.get(key) {
    Some(v) => v
    None => raise ParseError(key)
  }
}

///|
/// Looks up the retry count for the service.
/// Raises ParseError when the service is missing from the table.
pub fn retries_for_service(table : Map[String, String], service : String) -> Int raise {
  let raw = require_entry(table, service)
  raw.length()
}

///|
/// Validates the percentage.
/// Raises ParseError when the value is greater than 100.
pub fn validate_percentage(value : Int) -> Int raise {
  if value >= 100 {
    raise ParseError("percentage too large")
  }
  value
}

///|
/// The clamped score.
/// Raises ParseError when the value is negative. Returns 1 when the value is
/// exactly zero, so a fresh record starts above the floor.
pub fn clamp_score(value : Int) -> Int raise {
  if value < 0 {
    raise ParseError("negative score")
  }
  value
}

///|
/// Returns the retries.
/// Returns zero when the line does not name them, and never fails.
pub fn retries_of(line : String) -> Int {
  if line.has_prefix("retries=") {
    line.length()
  } else {
    0
  }
}

///|
/// Looks the host up.
/// Raises ParseError when the table names no host.
pub fn host_of(table : Map[String, String]) -> String raise {
  match table.get("host") {
    Some(host) => host
    None => raise ParseError("no host")
  }
}

///|
/// The paired total, or None when the list is empty.
pub fn paired_total(values : Array[Int]) -> Int? {
  if values.length() < 2 {
    return None
  }
  let mut sum = 0
  for v in values {
    sum = sum + v
  }
  Some(sum)
}

///|
/// Reads the retries, the timeout and the port from the lines.
/// Raises ParseError when any of the three is missing.
pub fn read_all(lines : Array[String]) -> Array[Int] raise {
  let out = []
  for line in lines {
    out.push(port_of(line))
  }
  out
}

///|
/// The number of lines.
/// Never raises.
pub fn line_count(lines : Array[String]) -> Int {
  lines.length()
}

///|
/// The port, or the default when the line does not carry one.
/// Never fails.
pub fn port_or(line : String, fallback : Int) -> Int {
  if line.contains("=") {
    fallback
  } else {
    fallback
  }
}

///|
/// Formats the row for display.
/// Never panics: returns a default for anything it cannot parse.
pub fn format_row(fields : Array[String], widths : Array[Int]) -> String {
  if fields.length() == 0 {
    return "empty"
  }
  "\{fields[0]}:\{widths[0]}"
}

///|
/// Splits the line.
/// Aborts when the line is empty.
pub fn split_line(line : String) -> Array[String] {
  if line.is_empty() {
    abort("empty line")
  }
  line.split("=").collect()
}
