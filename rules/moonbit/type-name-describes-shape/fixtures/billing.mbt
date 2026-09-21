///|
pub(all) struct Invoice {
  id : String
  lines : Array[String]
  total_cents : Int
}

///|
pub(all) struct CustomerId {
  name : String
  email : String
  address : String
}

///|
pub(all) struct Settings {
  errors : Array[String]
  warnings : Array[String]
}

///|
pub(all) struct Money {
  cents : Int
  currency : String
}

///|
pub(all) enum Status {
  Draft
  Sent
  Paid
}

///|
pub(all) enum Currencies {
  Usd
  Eur
}

///|
pub(all) struct Invoices {
  invoice : Invoice
}

///|
pub(all) struct Totals {
  by_currency : Map[String, Int]
  by_status : Map[String, Int]
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
pub fn describe(invoice : Invoice, status : Status) -> String {
  match status {
    Draft => "draft \{invoice.id}"
    Sent => "sent \{invoice.id}"
    Paid => "paid \{invoice.total_cents}"
  }
}
