import type { Pool } from "pg";
import type { User, Order, Cart, Invoice } from "../model.ts";

export async function getUser(db: Pool, id: string): Promise<User | null> {
  const { rows } = await db.query<User>("select * from users where id = $1", [id]);
  return rows[0] ?? null;
}

export async function fetchOrder(db: Pool, id: string): Promise<Order | null> {
  const { rows } = await db.query<Order>("select * from orders where id = $1", [id]);
  return rows[0] ?? null;
}

export async function loadCart(db: Pool, id: string): Promise<Cart | null> {
  const { rows } = await db.query<Cart>("select * from carts where id = $1", [id]);
  return rows[0] ?? null;
}

export async function retrieveInvoice(db: Pool, id: string): Promise<Invoice | null> {
  const { rows } = await db.query<Invoice>("select * from invoices where id = $1", [id]);
  return rows[0] ?? null;
}
