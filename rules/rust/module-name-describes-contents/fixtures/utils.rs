// Corpus file.

pub fn clamp(value: i64, low: i64, high: i64) -> i64 {
    if value < low {
        low
    } else if value > high {
        high
    } else {
        value
    }
}

pub fn repeat(text: &str, times: usize) -> String {
    let mut out = String::new();
    for _ in 0..times {
        out.push_str(text);
    }
    out
}
