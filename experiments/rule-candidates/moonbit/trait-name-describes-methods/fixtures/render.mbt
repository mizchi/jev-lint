///|
pub(all) struct Row {
  sku : String
  cents : Int
}

///|
pub(all) trait Printable {
  to_line(Self) -> String
}

///|
pub(all) trait Comparable {
  render(Self) -> String
}

///|
pub(all) trait Serializable {
  byte_len(Self) -> Int
}

///|
pub(all) trait Sortable {
  sort_key(Self) -> String
}

///|
pub(all) trait Named {
  name(Self) -> String
  compare(Self, Self) -> Int
  to_json(Self) -> String
}

///|
pub(all) trait Cacheable {
  cache_key(Self) -> String
  ttl_seconds(Self) -> Int
}

///|
pub(all) trait Validatable {
  errors(Self) -> Array[String]
}

///|
pub(all) trait Countable {
  length(Self) -> Int
  is_empty(Self) -> Bool
}

///|
pub(all) trait Summable {
  render_table(Self, Array[Row]) -> String
  header(Self) -> String
}

///|
pub(all) trait Copyable {
  copy(Self) -> Self
}

///|
pub(all) trait Closeable {
  open(Self) -> Unit
}

///|
pub fn line_of(row : Row) -> String {
  "\{row.sku} \{row.cents}"
}
