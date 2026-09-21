// Corpus file.

pub struct Order {
    pub id: u64,
    pub customer_id: u64,
    pub status: OrderStatus,
}

pub enum OrderStatus {
    Placed,
    Shipped,
    Cancelled,
}

pub struct OrderEvent {
    pub order_id: u64,
    pub status: OrderStatus,
    pub at_millis: u64,
}

pub fn create_order(customer_id: u64) -> Order {
    Order { id: 0, customer_id, status: OrderStatus::Placed }
}

pub fn cancel_order(order: &mut Order) {
    order.status = OrderStatus::Cancelled;
}

pub fn record_event(order: &Order, at_millis: u64) -> OrderEvent {
    OrderEvent { order_id: order.id, status: order.status_copy(), at_millis }
}

impl Order {
    fn status_copy(&self) -> OrderStatus {
        match self.status {
            OrderStatus::Placed => OrderStatus::Placed,
            OrderStatus::Shipped => OrderStatus::Shipped,
            OrderStatus::Cancelled => OrderStatus::Cancelled,
        }
    }
}

pub fn order_history(events: &[OrderEvent], order_id: u64) -> Vec<&OrderEvent> {
    events.iter().filter(|e| e.order_id == order_id).collect()
}
