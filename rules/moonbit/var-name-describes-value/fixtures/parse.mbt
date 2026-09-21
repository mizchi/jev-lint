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
pub fn distinct_tags(tags : Array[String]) -> Array[String] {
  let distinct_tags = []
  for tag in tags {
    if distinct_tags.length() == 0 ||
       distinct_tags[distinct_tags.length() - 1] != tag {
      distinct_tags.push(tag)
    }
  }
  distinct_tags
}

///|
pub fn header_of(source : String) -> String {
  let lines = source.split("\n").collect()
  let header = lines[0]
  header
}

///|
pub fn deduped_names(names : Array[String]) -> Array[String] {
  let seen = []
  let deduped_names = []
  for name in names {
    if not(seen.contains(name)) {
      deduped_names.push(name)
    }
  }
  deduped_names
}

///|
pub fn last_of(source : String) -> String {
  let lines = source.split("\n").collect()
  let last = lines[lines.length() - 1]
  last
}
