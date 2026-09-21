use std::collections::HashMap;

/// A row of a report.
pub struct Row {
    pub sku: String,
    pub cents: i64,
}

pub trait Printable {
    fn to_line(&self) -> String;
}

pub trait Comparable {
    fn render(&self) -> String;
}

pub trait Serializable {
    fn byte_len(&self) -> usize;
}

pub trait Sortable {
    fn sort_key(&self) -> String;
}

pub trait Named {
    fn name(&self) -> String;
    fn compare(&self, other: &Self) -> std::cmp::Ordering;
    fn to_json(&self) -> String;
}

pub trait Cacheable {
    fn cache_key(&self) -> String;
    fn ttl_seconds(&self) -> u64;
}

pub trait Validatable {
    fn errors(&self) -> Vec<String>;
}

pub trait Countable {
    fn len(&self) -> usize;
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

pub trait Summable {
    fn render_table(&self, rows: &[Row]) -> String;
    fn header(&self) -> String;
}

pub trait Copyable {}

impl Printable for Row {
    fn to_line(&self) -> String {
        format!("{} {}", self.sku, self.cents)
    }
}

pub fn render_all(rows: &[Row], index: &HashMap<String, Row>) -> String {
    let _ = index;
    rows.iter().map(|r| r.to_line()).collect::<Vec<_>>().join("\n")
}
