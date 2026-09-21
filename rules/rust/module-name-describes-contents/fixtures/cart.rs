// Corpus file.

pub struct Line {
    pub sku: String,
    pub price: i64,
}

pub fn total(lines: &[Line]) -> i64 {
    lines.iter().map(|line| line.price).sum()
}

pub fn add(mut lines: Vec<Line>, line: Line) -> Vec<Line> {
    lines.push(line);
    lines
}
