import type { Request, Response } from "express";
import { db } from "./db";
import { mailer } from "./mailer";
import { jobs } from "./jobs";

export async function deleteAccount(req: Request, res: Response): Promise<void> {
  const userId = req.params.id;
  const user = await db.users.find(userId);
  if (!user) {
    res.sendStatus(404);
    return;
  }
  await db.users.update(userId, { deletedAt: new Date(), status: "deleted" });
  res.json({ message: "Account permanently deleted" });
}

export async function closeAccount(req: Request, res: Response): Promise<void> {
  const userId = req.params.id;
  const user = await db.users.find(userId);
  if (!user) {
    res.sendStatus(404);
    return;
  }
  await db.users.update(userId, { deletedAt: new Date(), status: "deleted" });
  res.json({ message: "Account closed. Data is retained for 30 days, then removed." });
}

export async function requestPasswordReset(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email: string };
  const user = await db.users.findByEmail(email);
  if (user) {
    const token = await db.resetTokens.create(user.id);
    await mailer.send({ to: email, template: "password-reset", data: { token } });
  }
  res.send("Password updated");
}

export async function requestPasswordResetLink(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email: string };
  const user = await db.users.findByEmail(email);
  if (user) {
    const token = await db.resetTokens.create(user.id);
    await mailer.send({ to: email, template: "password-reset", data: { token } });
  }
  res.send("If an account exists for that address, a reset link has been sent.");
}

export async function purgeCache(req: Request, res: Response): Promise<void> {
  await jobs.enqueue("cache.purge", { scope: req.query.scope ?? "all" });
  res.status(202).json({ message: "Cache purge started" });
}

export async function rebuildIndex(req: Request, res: Response): Promise<void> {
  await jobs.enqueue("search.rebuild", { index: req.params.index });
  res.json({ message: "Index rebuilt" });
}

export async function validateWebhook(req: Request, res: Response): Promise<void> {
  const { url } = req.body as { url: string };
  try {
    new URL(url);
  } catch {
    res.status(400).json({ message: "Webhook URL is not a valid URL" });
    return;
  }
  res.sendStatus(204);
}

export async function updateWebhook(req: Request, res: Response): Promise<void> {
  const { url } = req.body as { url: string };
  await db.webhooks.update(req.params.id, { url });
  res.json({ message: "Webhook updated" });
}

export async function exportOrders(req: Request, res: Response): Promise<void> {
  const orders = await db.orders.listFor(req.user.id);
  if (orders.length === 0) {
    res.sendStatus(204);
    return;
  }
  res.setHeader("content-type", "text/csv");
  res.send(toCsv(orders));
}

export async function cancelSubscription(req: Request, res: Response): Promise<void> {
  const sub = await db.subscriptions.find(req.params.id);
  if (!sub) {
    res.sendStatus(404);
    return;
  }
  await db.subscriptions.cancel(sub.id, { atPeriodEnd: true });
  res.json({ message: "Subscription cancelled" });
}

export async function refundOrder(req: Request, res: Response): Promise<void> {
  const order = await db.orders.find(req.params.id);
  if (!order) {
    res.sendStatus(404);
    return;
  }
  const refund = await db.payments.refund(order.chargeId);
  if (refund.status !== "succeeded") {
    res.status(502).end();
    return;
  }
  res.json({ message: "Refund issued", refundId: refund.id });
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const record = await db.emailTokens.find(req.params.token);
  if (!record || record.usedAt || record.expiresAt < Date.now()) {
    res.status(400).json({ message: "This verification link has expired" });
    return;
  }
  await db.emailTokens.markUsed(record.id);
  await db.users.update(record.userId, { emailVerifiedAt: new Date() });
  res.sendStatus(204);
}

export async function pingUpstream(req: Request, res: Response): Promise<void> {
  const started = Date.now();
  await db.raw("select 1");
  res.send(`ok ${Date.now() - started}ms`);
}

declare function toCsv(rows: unknown[]): string;
