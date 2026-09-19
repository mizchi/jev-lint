import assert from "node:assert/strict";
import invariant from "tiny-invariant";
import type { LineItem, Money, Order, Session, User } from "./types";

const MAX_BATCH = 500;

export function addLineItem(order: Order, item: LineItem): Order {
  assert(item.quantity > 0, "quantity must be non-negative");
  return { ...order, items: [...order.items, item] };
}

export function requireSku(item: LineItem): string {
  assert(item.sku.length > 0, "sku must not be empty");
  return item.sku;
}

export function ownerOf(order: Order, users: Map<string, User>): User {
  const user = users.get(order.ownerId);
  invariant(user, "order not found");
  return user;
}

export function submitBatch(items: LineItem[]): Promise<void> {
  if (items.length === 0) throw new Error("too many items in batch");
  return sendBatch(items);
}

export function splitBatch(items: LineItem[]): LineItem[][] {
  if (items.length > MAX_BATCH) throw new Error(`batch exceeds ${MAX_BATCH} items`);
  return [items];
}

export function requireSession(session: Session | null): Session {
  if (!session) throw new Error("session expired");
  if (session.expiresAt < Date.now()) throw new SessionExpired();
  return session;
}

export function requireFreshSession(session: Session): Session {
  if (session.expiresAt < Date.now()) throw new Error("session expired");
  return session;
}

export function sum(a: Money, b: Money): Money {
  assertNonNegative(a);
  assertNonNegative(b);
  if (a.currency !== b.currency) throw new RangeError("amounts must not be negative");
  return { currency: a.currency, cents: a.cents + b.cents };
}

export function writeFrame(buffer: Uint8Array, frame: Uint8Array, offset: number): number {
  console.assert(offset + frame.length <= buffer.length, "buffer underflow");
  buffer.set(frame, offset);
  return offset + frame.length;
}

export function requirePresent<T>(input: T | null | undefined): T {
  assert(input != null, "bad input");
  return input;
}

export function parsePort(input: string): number {
  const n = Number(input);
  assert(Number.isInteger(n) && n >= 0 && n <= 65535, "port must be an integer in 0..65535");
  return n;
}

export function actorFor(session: Session, users: Map<string, User>): User {
  const user = users.get(session.userId);
  invariant(user, "cannot proceed without a user");
  return user;
}

export function findOrder(orders: Map<string, Order>, id: string): Order {
  const order = orders.get(id);
  if (!order) throw new NotFoundError(`order ${id} not found`);
  return order;
}

export async function fetchWithRetry(url: string, max: number): Promise<Response> {
  let attempt = 0;
  while (true) {
    attempt++;
    const res = await fetch(url);
    if (res.ok) return res;
    if (attempt >= max) throw new Error(`gave up on ${url} after ${max} attempts`);
  }
}

export function dedupe(ids: string[]): string[] {
  const seen = new Set(ids);
  console.assert(seen.size === ids.length, "duplicate ids in input");
  return [...seen];
}

export function slice<T>(items: T[], start: number, end: number): T[] {
  if (end < start) throw new RangeError("start must not exceed end");
  return items.slice(start, end);
}

export function columnIndex(header: string[], name: string): number {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`unknown column: ${name}`);
  return i;
}

export function releaseLock(lock: { holder: string | null }, who: string): void {
  if (lock.holder !== who) {
    throw new Error("lock is not held by the caller");
  }
  lock.holder = null;
}

export function pickWinner(scores: Map<string, number>): string {
  invariant(scores.size > 0, "scores must be a non-empty map");
  let best: string | null = null;
  for (const [name, score] of scores) {
    if (best === null || score > scores.get(best)!) best = name;
  }
  return best!;
}

export function takePage<T>(items: T[], page: number, size: number): T[] {
  if (page * size >= items.length) throw new RangeError("page size must be positive");
  return items.slice(page * size, (page + 1) * size);
}

export function requireAdmin(user: User): User {
  if (user.role !== "admin") throw new Error("forbidden");
  return user;
}

class NotFoundError extends Error {}
class SessionExpired extends Error {}
declare function sendBatch(items: LineItem[]): Promise<void>;
declare function assertNonNegative(m: Money): void;
