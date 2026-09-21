///|
pub(all) struct Row {
  name : String
  bytes : Int
  ms : Int
}

///|
let default_timeout_ms : Int = 30

///|
pub fn summarise(rows : Array[Row]) -> String {
  let names = rows.length()
  let mut total_bytes = 0
  for row in rows {
    total_bytes = total_bytes + row.bytes
  }
  let slowest = rows[0]
  for row in rows {
    if row.ms > slowest.ms {
      ignore(row)
    }
  }
  let is_empty = rows.length()
  let lines = []
  for row in rows {
    lines.push(row.name)
  }
  "\{names} rows, \{total_bytes} bytes, first \{slowest.name}, \{is_empty}"
}

///|
pub fn widest(rows : Array[Row]) -> Row {
  let mut widest = rows[0]
  for row in rows {
    if row.name.length() > widest.name.length() {
      widest = row
    }
  }
  widest
}

///|
pub fn header(rows : Array[Row]) -> String {
  let columns = ["name", "bytes", "ms"]
  let separator = "  "
  columns.join(separator)
}

///|
pub fn timeout_seconds() -> Int {
  let seconds = default_timeout_ms
  seconds
}
