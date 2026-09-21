///|
/// A product as the catalog importer sees it.
pub(all) struct Product {
  id : String
  name : String
  stock : Int
  weight : Int
}

///|
/// A catalog, mutable because the importer fills it in passes.
pub(all) struct Catalog {
  products : Array[Product]
  mut revision : Int
  mut rendered : String
}

///|
/// The SKUs tonight's warehouse job should restock.
let restock_queue : Array[String] = []

///|
/// Shelf scores already worked out in this process.
let score_cache : Map[String, Int] = Map([])

///|
pub fn compute_index(products : Array[Product]) -> Map[String, Product] {
  let index = Map([])
  for product in products {
    index.set(product.id, product)
  }
  index
}

///|
pub fn compute_rank(product : Product) -> Int {
  let capped = if product.stock > 100 { 100 } else { product.stock }
  capped * 3 - product.weight / 10
}

///|
pub fn calculate_shelf_score(product : Product) -> Int {
  match score_cache.get(product.id) {
    Some(hit) => hit
    None => {
      let score = compute_rank(product) + product.name.length()
      score_cache.set(product.id, score)
      score
    }
  }
}

///|
pub fn compute_restock_plan(catalog : Catalog) -> Int {
  restock_queue.clear()
  for product in catalog.products {
    if product.stock < 5 {
      restock_queue.push(product.id)
    }
  }
  restock_queue.length()
}

///|
pub fn derive_slug(name : String) -> String {
  let out = StringBuilder()
  for c in name {
    if c == ' ' {
      out.write_char('-')
    } else {
      out.write_char(c)
    }
  }
  out.to_string()
}

///|
/// Clamps a raw count the importer read from the batch manifest into a
/// sane bound, or falls back to the default when it is not set at all.
fn read_env_int(value : Int, fallback : Int, low : Int, high : Int) -> Int {
  if value == 0 {
    fallback
  } else if value < low {
    low
  } else if value > high {
    high
  } else {
    value
  }
}

///|
fn read_env_string(value : String, fallback : String) -> String {
  if value.length() == 0 {
    fallback
  } else {
    value
  }
}

///|
pub(all) struct ImportLimits {
  max_batch : Int
  queue : String
  timeout_sec : Int
}

///|
pub fn parse_import_limits(
  raw_max_batch : Int,
  raw_queue : String,
  raw_timeout_sec : Int
) -> ImportLimits {
  {
    max_batch: read_env_int(raw_max_batch, 4, 1, 64),
    queue: read_env_string(raw_queue, "default"),
    timeout_sec: read_env_int(raw_timeout_sec, 30, 1, 3600),
  }
}

///|
pub fn to_stock_report(catalog : Catalog) -> String {
  let mut low = 0
  for product in catalog.products {
    if product.stock < 5 {
      low = low + 1
    }
  }
  "revision \{catalog.revision}: \{catalog.products.length()} products, \{low} low"
}

///|
pub fn to_search_entry(product : Product, index : Map[String, String]) -> String {
  let entry = "\{derive_slug(product.name)}#\{product.id}"
  index.set(product.id, entry)
  entry
}

///|
pub fn Product::to_json(self : Product) -> String {
  "{\"id\":\"\{self.id}\",\"stock\":\{self.stock}}"
}

///|
pub fn format_catalog_page(catalog : Catalog) -> String {
  let text = to_stock_report(catalog)
  catalog.rendered = text
  text
}

///|
pub fn Catalog::compute_revision(self : Catalog, now : Int) -> Int {
  self.revision = now + self.products.length()
  self.revision
}

///|
pub fn parse_catalog(rows : Array[Array[String]]) -> Catalog {
  let products = []
  for row in rows {
    if row.length() == 4 {
      let stock = match parse_amount(row[2]) {
        Some(n) => n
        None => 0
      }
      let weight = match parse_amount(row[3]) {
        Some(n) => n
        None => 0
      }
      products.push({ id: row[0], name: row[1], stock, weight })
    }
  }
  { products, revision: 0, rendered: "" }
}

///|
pub fn compute_known_score_total(ids : Array[String]) -> Int {
  let mut sum = 0
  for id in ids {
    match score_cache.get(id) {
      Some(score) => sum = sum + score
      None => ()
    }
  }
  sum
}

///|
/// Writes one line to the importer's trace stream.
fn trace_row(text : String) -> Unit {
  println("[catalog] \{text}")
}

///|
pub fn format_debug_row(product : Product) -> String {
  let row = "\{product.id}\t\{product.stock}\t\{product.weight}"
  trace_row(row)
  row
}

///|
/// The weight bands, read out of the packed table on first use.
let weight_bands : Map[Int, String] = Map([])

///|
/// Hands back the weight band table, filling it in on the first call.
fn bands() -> Map[Int, String] {
  if weight_bands.length() == 0 {
    weight_bands.set(0, "light")
    weight_bands.set(50, "heavy")
  }
  weight_bands
}

///|
pub fn format_weight_band(product : Product) -> String {
  let table = bands()
  match table.get(if product.weight < 50 { 0 } else { 50 }) {
    Some(name) => name
    None => "unknown"
  }
}
