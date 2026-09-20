export interface Order {
  id: string;
  customerId: string;
  totalCents: number;
  placedAt: string;
}

export interface OrderRow {
  id: string;
  customer_id: string;
  total_cents: number;
  placed_at: string;
}
