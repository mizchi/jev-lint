import type { Db } from "../db.ts";
import type { Order, OrderRow } from "./types.ts";

function fromRow(row: OrderRow): Order {
  return { id: row.id, buyerId: row.customer_id, totalCents: row.total_cents, placedAt: row.placed_at };
}

export async function ordersFor(db: Db, buyerId: string): Promise<Order[]> {
  const rows = await db.all<OrderRow>("select * from orders where customer_id = ? order by placed_at desc", [buyerId]);
  return rows.map(fromRow);
}

export async function insertOrder(db: Db, order: Order): Promise<void> {
  await db.run("insert into orders (id, customer_id, total_cents, placed_at) values (?, ?, ?, ?)", [
    order.id,
    order.buyerId,
    order.totalCents,
    order.placedAt,
  ]);
}
