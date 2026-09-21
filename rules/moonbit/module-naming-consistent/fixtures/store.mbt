///|
pub(all) struct Record {
  key : String
  value : String
}

///|
pub fn get_record(records : Array[Record], key : String) -> Record? {
  for r in records {
    if r.key == key {
      return Some(r)
    }
  }
  None
}

///|
pub fn fetch_value(records : Array[Record], key : String) -> String {
  match get_record(records, key) {
    Some(r) => r.value
    None => ""
  }
}

///|
pub fn put_record(records : Array[Record], record : Record) -> Array[Record] {
  let out = records.copy()
  out.push(record)
  out
}

///|
pub fn save_value(records : Array[Record], key : String, value : String) -> Array[Record] {
  put_record(records, { key, value })
}

///|
pub fn delete_record(records : Array[Record], key : String) -> Array[Record] {
  let out = []
  for r in records {
    if r.key != key {
      out.push(r)
    }
  }
  out
}

///|
pub fn drop_value(records : Array[Record], key : String) -> Array[Record] {
  delete_record(records, key)
}
