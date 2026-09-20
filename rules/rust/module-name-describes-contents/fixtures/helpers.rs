// Corpus file.

pub fn format_yen(cents: i64) -> String {
    format!("¥{}", cents / 100)
}

pub fn parse_yen(text: &str) -> Option<i64> {
    text.trim_start_matches('¥').parse::<i64>().ok().map(|v| v * 100)
}

pub fn to_minor_units(major: f64) -> i64 {
    (major * 100.0).round() as i64
}

pub fn split_evenly(total_cents: i64, ways: i64) -> Vec<i64> {
    if ways <= 0 {
        return Vec::new();
    }
    let base = total_cents / ways;
    let remainder = total_cents % ways;
    (0..ways).map(|i| if i < remainder { base + 1 } else { base }).collect()
}
