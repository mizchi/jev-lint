// Corpus file.

pub struct Stock {
    pub sku: String,
    pub on_hand: u32,
    pub reserved: u32,
}

pub fn adjust_stock(stock: &mut Stock, delta: i32) {
    let next = stock.on_hand as i32 + delta;
    stock.on_hand = if next < 0 { 0 } else { next as u32 };
}

pub fn reserve_stock(stock: &mut Stock, qty: u32) -> bool {
    let available = stock.on_hand.saturating_sub(stock.reserved);
    if qty > available {
        return false;
    }
    stock.reserved += qty;
    true
}

pub fn release_reservation(stock: &mut Stock, qty: u32) {
    stock.reserved = stock.reserved.saturating_sub(qty);
}

pub fn format_price(cents: i64) -> String {
    format!("${}.{:02}", cents / 100, cents % 100)
}
