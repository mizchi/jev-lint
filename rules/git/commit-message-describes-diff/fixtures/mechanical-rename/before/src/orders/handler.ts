import type { Request, Response } from "../http.ts";
import { ordersFor } from "./repo.ts";

export async function listOrders(req: Request, res: Response): Promise<void> {
  const customerId = req.session.user.id;
  const orders = await ordersFor(req.db, customerId);
  res.json({ customerId, orders });
}
