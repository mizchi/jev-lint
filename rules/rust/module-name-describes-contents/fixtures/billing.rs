// Corpus file.

pub struct Invoice {
    pub id: u64,
    pub customer_id: u64,
    pub total_cents: i64,
    pub paid: bool,
}

pub fn create_invoice(customer_id: u64, total_cents: i64) -> Invoice {
    Invoice { id: 0, customer_id, total_cents, paid: false }
}

pub fn mark_paid(invoice: &mut Invoice) {
    invoice.paid = true;
}

pub fn void_invoice(invoice: &mut Invoice) {
    invoice.total_cents = 0;
}

pub struct EmailAddress(pub String);

pub fn send_email(to: &EmailAddress, subject: &str, body: &str) -> bool {
    !to.0.is_empty() && !subject.is_empty() && !body.is_empty()
}
