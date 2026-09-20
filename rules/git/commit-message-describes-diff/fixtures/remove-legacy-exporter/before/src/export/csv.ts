import type { Order } from "../orders/types.ts";
import { stringify } from "./stringify.ts";

export function exportCsv(orders: Order[]): string {
  return stringify(
    orders.map((o) => ({
      id: o.id,
      customer: o.customerEmail,
      total: (o.totalCents / 100).toFixed(2),
      created_at: o.createdAt.toISOString(),
    })),
  );
}
