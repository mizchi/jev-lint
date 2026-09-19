import type { Pool } from "pg";
import type { Order, OrderInput } from "../model.ts";

export async function getOrder(db: Pool, id: string): Promise<Order> {
  const { rows } = await db.query<Order>("select * from orders where id = $1", [id]);
  if (!rows[0]) throw new Error(`order ${id} not found`);
  return rows[0];
}

export async function findOrdersByCustomer(db: Pool, customerId: string): Promise<Order[]> {
  const { rows } = await db.query<Order>("select * from orders where customer_id = $1", [customerId]);
  return rows;
}

export async function listOrders(db: Pool, limit = 50, offset = 0): Promise<Order[]> {
  const { rows } = await db.query<Order>("select * from orders order by created_at desc limit $1 offset $2", [limit, offset]);
  return rows;
}

export async function createOrder(db: Pool, input: OrderInput): Promise<Order> {
  const { rows } = await db.query<Order>(
    "insert into orders (customer_id, lines, status) values ($1, $2, 'draft') returning *",
    [input.customerId, JSON.stringify(input.lines)],
  );
  return rows[0];
}

export async function cancelOrder(db: Pool, id: string): Promise<void> {
  await db.query("update orders set status = 'cancelled' where id = $1 and status = 'draft'", [id]);
}
