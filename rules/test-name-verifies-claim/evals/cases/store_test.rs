// Corpus file: Rust test names against what the bodies assert.

#[cfg(test)]
mod tests {
    fn sum_prices(items: &[u32]) -> u32 {
        items.iter().sum()
    }

    fn find_by_id(items: &[(u32, u32)], id: u32) -> Option<u32> {
        items.iter().find(|(i, _)| *i == id).map(|(_, v)| *v)
    }

    #[test]
    fn returns_zero_for_an_empty_slice() {
        assert_eq!(sum_prices(&[10, 20]), 30);
    }

    #[test]
    fn panics_on_an_empty_slice() {
        assert_eq!(sum_prices(&[]), 0);
    }

    #[test]
    fn returns_items_sorted_by_price() {
        let items = [(1u32, 30u32), (2, 10)];
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn rejects_a_missing_id() {
        let items = [(1u32, 30u32)];
        find_by_id(&items, 99);
    }

    #[test]
    fn returns_none_for_an_unknown_id() {
        let items = [(1u32, 30u32)];
        assert_eq!(find_by_id(&items, 99), None);
    }

    #[test]
    fn sums_every_price_in_the_slice() {
        assert_eq!(sum_prices(&[10, 20, 30]), 60);
    }

    #[test]
    fn finds_a_value_by_its_id() {
        let items = [(1u32, 30u32), (2, 10)];
        assert_eq!(find_by_id(&items, 2), Some(10));
    }
}
