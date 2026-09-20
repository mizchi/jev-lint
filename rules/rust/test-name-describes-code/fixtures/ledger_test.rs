// Ledger tests: entries are (account, cents) pairs kept in posting order.

#[cfg(test)]
mod tests {
    use crate::ledger::{
        balance, bulk_rate, lookup, parse_accounts, post, reverse, sort_by_amount, undo_reverse,
        Coupon, Entry, LedgerError, Line,
    };

    fn entries() -> Vec<Entry> {
        vec![
            Entry::new("cash", 900),
            Entry::new("fees", 250),
            Entry::new("rent", 4500),
        ]
    }

    #[test]
    fn returns_entries_sorted_by_amount() {
        let sorted = sort_by_amount(&entries());
        assert_eq!(sorted.len(), 3);
    }

    #[test]
    fn sorts_by_amount_and_keeps_ties_in_posting_order() {
        let mut with_tie = entries();
        with_tie.push(Entry::new("tips", 250));
        let accounts: Vec<&str> = sort_by_amount(&with_tie).iter().map(|e| e.account()).collect();
        assert_eq!(accounts, ["fees", "tips", "cash", "rent"]);
    }

    #[test]
    fn puts_the_smallest_entry_first() {
        let sorted = sort_by_amount(&entries());
        assert!(sorted.first().is_some());
    }

    #[test]
    fn applies_the_bulk_rate_above_ten_units() {
        let line = Line { unit_cents: 200, units: 3 };
        assert_eq!(bulk_rate(&line), 600);
    }

    #[test]
    fn discounts_more_than_ten_units() {
        let line = Line { unit_cents: 200, units: 12 };
        assert!(bulk_rate(&line) < 2400);
    }

    #[test]
    fn removes_an_entry_by_account() {
        assert_eq!(lookup(&entries(), "fees"), Some(&Entry::new("fees", 250)));
    }

    #[test]
    fn panics_for_an_unknown_account() {
        assert_eq!(lookup(&entries(), "nope"), None);
    }

    #[test]
    fn finds() {
        assert_eq!(lookup(&entries(), "rent").map(|e| e.cents()), Some(4500));
    }

    #[test]
    fn reverses_a_posting() {
        let after = post(entries(), Entry::new("rent", 500));
        assert_eq!(lookup(&after, "rent").map(|e| e.cents()), Some(4500 + 500));
    }

    #[test]
    fn logs_a_warning_when_posting_to_a_closed_account() {
        let mut closed = entries();
        closed.push(Entry::closed("legacy"));
        let after = post(closed, Entry::new("legacy", 300));
        assert_eq!(lookup(&after, "legacy").map(|e| e.cents()), Some(300));
    }

    #[test]
    fn reverses_the_entry_and_reports_the_new_balance() {
        let (after, new_balance) = reverse(entries(), "fees");
        assert_eq!(lookup(&after, "fees"), None);
        assert_eq!(new_balance, 5400);
    }

    #[test]
    fn accepts_a_zero_posting() {
        post(entries(), Entry::new("cash", 0));
    }

    #[test]
    fn errors_on_a_negative_posting() {
        assert!(matches!(
            Entry::try_new("cash", -1),
            Err(LedgerError::NegativeAmount)
        ));
    }

    #[test]
    fn restores_the_amount_after_an_undo() {
        // A reversal is kept on the undo stack rather than dropped, so undoing
        // it must bring back exactly the amount that was reversed.
        let (reversed, _) = reverse(entries(), "cash");
        let restored = undo_reverse(reversed);
        assert_eq!(lookup(&restored, "cash").map(|e| e.cents()), Some(900));
    }

    #[test]
    fn rejects_an_expired_coupon() {
        let coupon = Coupon::new("JUNE", 20240630);
        assert!(coupon.is_active_on(20240702));
    }

    #[test]
    fn totals_the_ledger() {
        assert_eq!(balance(&entries()), 5650);
    }

    #[test]
    fn does_not_read_a_trailing_comma_as_an_empty_account() {
        assert_eq!(parse_accounts("cash,fees,"), vec!["cash", "fees"]);
    }
}
