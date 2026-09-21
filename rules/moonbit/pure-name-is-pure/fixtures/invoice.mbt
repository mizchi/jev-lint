///|
/// One billable item on an invoice.
pub(all) struct Item {
  sku : String
  unit_price : Int
  qty : Int
}

///|
/// An invoice as the billing module keeps it while it is being built.
pub(all) struct Invoice {
  number : String
  items : Array[Item]
  mut total : Int
}

///|
/// Rows the importer could not read, kept for the nightly report.
let rejected_rows : Array[String] = []

///|
pub fn compute_subtotal(items : Array[Item]) -> Int {
  let mut sum = 0
  for item in items {
    sum = sum + item.unit_price * item.qty
  }
  sum
}

///|
pub fn calculate_tax(subtotal : Int, rate_percent : Int) -> Int {
  subtotal * rate_percent / 100
}

///|
/// A scratch running total, boxed so a helper can add to it in a loop.
pub(all) struct Accumulator {
  mut total : Int
}

///|
pub fn calculate_shipping_weight(items : Array[Item]) -> Int {
  let box : Accumulator = { total: 0 }
  for item in items {
    box.total = box.total + item.qty * 2
  }
  box.total
}

///|
pub fn compute_totals(invoice : Invoice, rate_percent : Int) -> Int {
  let subtotal = compute_subtotal(invoice.items)
  invoice.total = subtotal + calculate_tax(subtotal, rate_percent)
  invoice.total
}

///|
pub fn calculate_due(invoice : Invoice, paid : Int) -> Int {
  let due = invoice.total - paid
  println("invoice \{invoice.number} due \{due}")
  due
}

///|
pub fn format_money(cents : Int) -> String {
  "\{cents / 100}.\{cents % 100}"
}

///|
pub fn format_item_line(item : Item) -> String {
  "\{item.sku} x\{item.qty} @ \{format_money(item.unit_price)}"
}

///|
pub fn format_summary(invoice : Invoice) -> String {
  let parts = []
  for item in invoice.items {
    parts.push(format_item_line(item))
  }
  parts.push("total \{format_money(invoice.total)}")
  parts.join("\n")
}

///|
/// A scratch tally, boxed so a helper can fold into it in a loop.
pub(all) struct Tally {
  mut total : Int
  mut count : Int
}

///|
fn bump(t : Tally, amount : Int) -> Unit {
  t.total = t.total + amount
  t.count = t.count + 1
}

///|
pub fn calculate_average_price(items : Array[Item]) -> Int {
  let t : Tally = { total: 0, count: 0 }
  for item in items {
    bump(t, item.unit_price)
  }
  if t.count == 0 {
    0
  } else {
    t.total / t.count
  }
}

///|
pub fn derive_item_labels(items : Array[Item]) -> Array[String] {
  let labels = []
  for item in items {
    if item.qty > 0 {
      labels.push("\{item.sku}-\{item.qty}")
    }
  }
  labels
}

///|
pub fn derive_price_index(existing : Map[String, Int], items : Array[Item]) -> Map[String, Int] {
  let index = Map([])
  for item in items {
    match existing.get(item.sku) {
      Some(v) => index.set(item.sku, v)
      None => index.set(item.sku, item.unit_price)
    }
  }
  index
}

///|
pub fn derive_order_key(invoice : Invoice) -> String {
  "\{invoice.number}/\{invoice.items.length()}"
}

///|
/// Flags for the billing job: mostly argv, with a fallback for the token so
/// an operator does not have to pass it by hand on every run.
pub(all) struct BillingOptions {
  invoice_dir : String
  api_token : String
  currency : String
  dry_run : Bool
}

///|
pub fn parse_billing_options(argv : Array[String]) -> BillingOptions {
  let mut invoice_dir = "."
  let mut api_token = match @sys.getenv("BILLING_API_TOKEN") {
    Some(v) => v
    None => ""
  }
  let mut currency = "JPY"
  let mut dry_run = false
  let mut i = 0
  while i < argv.length() {
    match argv[i] {
      "--dir" => { invoice_dir = argv[i + 1]; i = i + 1 }
      "--token" => { api_token = argv[i + 1]; i = i + 1 }
      "--currency" => { currency = argv[i + 1]; i = i + 1 }
      "--dry-run" => dry_run = true
      _ => ()
    }
    i = i + 1
  }
  { invoice_dir, api_token, currency, dry_run }
}

///|
pub fn derive_discount_notes(items : Array[Item], notes : Array[String]) -> Int {
  let mut saved = 0
  for item in items {
    if item.qty >= 10 {
      let cut = item.unit_price * item.qty / 10
      saved = saved + cut
      notes.push("bulk \{item.sku} -\{format_money(cut)}")
    }
  }
  saved
}

///|
pub fn to_receipt(invoice : Invoice) -> String {
  let mut text = "receipt \{invoice.number}\n"
  for item in invoice.items {
    text = text + format_item_line(item) + "\n"
  }
  text + "paid \{format_money(invoice.total)}"
}

///|
pub fn calculate_running_max_price(items : Array[Item]) -> Int {
  let peak = Ref::new(0)
  for item in items {
    if item.unit_price > peak.val {
      peak.val = item.unit_price
    }
  }
  peak.val
}

///|
pub fn parse_amount(text : String) -> Int? {
  let mut value = 0
  let mut seen = false
  for c in text {
    if c >= '0' && c <= '9' {
      value = value * 10 + (c.to_int() - '0'.to_int())
      seen = true
    } else {
      return None
    }
  }
  if seen {
    Some(value)
  } else {
    None
  }
}

///|
pub fn parse_item(fields : Array[String]) -> Item? {
  if fields.length() != 3 {
    rejected_rows.push("field count \{fields.length()}")
    return None
  }
  match (parse_amount(fields[1]), parse_amount(fields[2])) {
    (Some(price), Some(qty)) => Some({ sku: fields[0], unit_price: price, qty })
    _ => {
      rejected_rows.push(fields[0])
      None
    }
  }
}

///|
pub fn derive_sorted_items(invoice : Invoice) -> Array[Item] {
  let sorted = invoice.items.copy()
  sorted.sort_by(fn(a, b) { b.qty - a.qty })
  sorted
}

///|
pub fn compute_rebilled(invoice : Invoice, rate_percent : Int) -> Invoice {
  let subtotal = compute_subtotal(invoice.items)
  { ..invoice, total: subtotal + calculate_tax(subtotal, rate_percent) }
}

///|
pub fn parse_next_field(tokens : Array[String]) -> String? {
  if tokens.length() == 0 {
    return None
  }
  let head = tokens[0]
  tokens.remove(0) |> ignore
  Some(head)
}
