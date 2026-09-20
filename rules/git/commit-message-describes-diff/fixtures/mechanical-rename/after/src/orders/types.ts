export interface Order {
  id: string;
  buyerId: string;
  totalCents: number;
  placedAt: string;
}

export interface OrderRow {
  id: string;
  customer_id: string;
  total_cents: number;
  placed_at: string;
}
