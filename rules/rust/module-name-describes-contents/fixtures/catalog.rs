// Corpus file.

pub struct Category {
    pub id: u64,
    pub name: String,
}

pub struct Product {
    pub id: u64,
    pub category_id: u64,
    pub name: String,
    pub price_cents: i64,
}

pub fn find_category(categories: &[Category], id: u64) -> Option<&Category> {
    categories.iter().find(|c| c.id == id)
}

pub fn products_in_category(products: &[Product], category_id: u64) -> Vec<&Product> {
    products.iter().filter(|p| p.category_id == category_id).collect()
}

pub fn discounted_price(product: &Product, percent_off: u32) -> i64 {
    product.price_cents - (product.price_cents * percent_off as i64 / 100)
}
