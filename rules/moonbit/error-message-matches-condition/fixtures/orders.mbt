///|
pub(all) suberror OrderError String

///|
pub fn charge(balance : Int, amount : Int) -> Int raise {
  if balance < amount {
    raise OrderError("amount must be positive")
  }
  balance - amount
}

///|
pub fn refund(balance : Int, amount : Int) -> Int raise {
  if amount <= 0 {
    raise OrderError("amount must be positive")
  }
  balance + amount
}

///|
pub fn ship(items : Array[String], address : String) -> String raise {
  if address.is_empty() {
    raise OrderError("no items to ship")
  }
  if items.length() == 0 {
    raise OrderError("no items to ship")
  }
  address
}

///|
pub fn authorise(role : String, owner : String) -> Unit raise {
  if role != "admin" {
    raise OrderError("order not found")
  }
  ignore(owner)
}

///|
pub fn line_at(items : Array[String], index : Int) -> String {
  if index >= items.length() {
    abort("no line at \{index}")
  }
  items[index]
}

///|
pub fn require_currency(currency : String) -> Unit raise {
  if currency.length() != 3 {
    raise OrderError("currency must be three letters")
  }
}

///|
pub fn cancel(status : String) -> String raise {
  if status == "shipped" {
    raise OrderError("a shipped order cannot be cancelled")
  }
  "cancelled"
}

///|
pub fn quantity_of(text : String) -> Int {
  if text.is_empty() {
    abort("quantity is required")
  }
  text.length()
}

///|
pub fn discount_for(total : Int, percent : Int) -> Int raise {
  if percent > 100 {
    raise OrderError("total must not be negative")
  }
  total * (100 - percent) / 100
}
