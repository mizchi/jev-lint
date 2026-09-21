///|
pub fn read(source : String) -> Array[String] {
  let path = source.split("\n").collect()
  let first_line = path[path.length() - 1]
  let has_header = first_line.split(",").collect()
  let rows = []
  for line in path {
    rows.push(line)
  }
  ignore(has_header)
  rows
}

///|
pub fn header_of(source : String) -> String {
  let lines = source.split("\n").collect()
  let header = lines[0]
  header
}

///|
pub fn last_of(source : String) -> String {
  let lines = source.split("\n").collect()
  let last = lines[lines.length() - 1]
  last
}
